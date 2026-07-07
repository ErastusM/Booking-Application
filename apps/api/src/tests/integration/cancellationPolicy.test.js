/**
 * Cancellation-policy enforcement: customers must give the provider's
 * configured notice (bookingPolicy.cancellationWindowHours, default 24,
 * 0 = anytime) to cancel or reschedule. Admins are exempt; the no-login
 * manage-token paths enforce the same window.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduledClient: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeAdmin, makeService, makeAppointment, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

// A confirmed appointment starting `hoursFromNow` hours from now (local time).
const apptAt = async (customer, service, provider, hoursFromNow, overrides = {}) => {
    const at = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
    const hh = String(at.getHours()).padStart(2, '0');
    const mm = String(at.getMinutes()).padStart(2, '0');
    return makeAppointment(customer._id, service._id, provider._id, {
        appointmentDate: at,
        startTime: `${hh}:${mm}`,
        endTime: `${hh}:${mm}`, // end is irrelevant to the policy
        status: 'confirmed',
        manageToken: `tok-${Math.random().toString(36).slice(2)}`,
        ...overrides,
    });
};

const setup = async () => {
    const provider = await makeProvider();
    const service = await makeService(provider._id);
    const customer = await makeUser();
    return { provider, service, customer };
};

describe('customer cancel (DELETE /api/appointments/:id)', () => {
    it('blocks inside the default 24h window, allows outside it', async () => {
        const { provider, service, customer } = await setup();
        const inside = await apptAt(customer, service, provider, 5);
        const outside = await apptAt(customer, service, provider, 48);

        const blocked = await request(app).delete(`/api/appointments/${inside._id}`).set(authHeader(customer));
        expect(blocked.status).toBe(400);
        expect(blocked.body.message).toMatch(/24 hours notice/i);

        const ok = await request(app).delete(`/api/appointments/${outside._id}`).set(authHeader(customer));
        expect(ok.status).toBe(200);
    });

    it("honours the provider's custom window, and 0 = cancel anytime", async () => {
        const { provider, service, customer } = await setup();
        provider.bookingPolicy = { cancellationWindowHours: 48 };
        await provider.save();
        const appt30h = await apptAt(customer, service, provider, 30);
        const blocked = await request(app).delete(`/api/appointments/${appt30h._id}`).set(authHeader(customer));
        expect(blocked.status).toBe(400);
        expect(blocked.body.message).toMatch(/48 hours/i);

        provider.bookingPolicy = { cancellationWindowHours: 0 };
        await provider.save();
        const appt1h = await apptAt(customer, service, provider, 1);
        const ok = await request(app).delete(`/api/appointments/${appt1h._id}`).set(authHeader(customer));
        expect(ok.status).toBe(200);
    });

    it('admins are exempt from the window', async () => {
        const { provider, service, customer } = await setup();
        const admin = await makeAdmin();
        const inside = await apptAt(customer, service, provider, 2);
        const res = await request(app).delete(`/api/appointments/${inside._id}`).set(authHeader(admin));
        expect(res.status).toBe(200);
    });

    it('a booking that already took place cannot be cancelled — even with a 0-hour window', async () => {
        const { provider, service, customer } = await setup();
        provider.bookingPolicy = { cancellationWindowHours: 0 };
        await provider.save();
        const past = await apptAt(customer, service, provider, -24 * 21); // three weeks ago
        const res = await request(app).delete(`/api/appointments/${past._id}`).set(authHeader(customer));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already taken place/i);
    });
});

describe('customer reschedule (PUT /api/appointments/:id/reschedule)', () => {
    it('blocks moving a booking that is inside the window', async () => {
        const { provider, service, customer } = await setup();
        const inside = await apptAt(customer, service, provider, 5);
        const res = await request(app)
            .put(`/api/appointments/${inside._id}/reschedule`)
            .set(authHeader(customer))
            .send({ appointmentDate: '2027-03-03', startTime: '10:00' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/24 hours notice/i);
    });
});

describe('customer reschedule of past bookings', () => {
    it('a past booking cannot be rescheduled forward, even with a 0-hour window', async () => {
        const { provider, service, customer } = await setup();
        provider.bookingPolicy = { cancellationWindowHours: 0 };
        await provider.save();
        const past = await apptAt(customer, service, provider, -48);
        const res = await request(app)
            .put(`/api/appointments/${past._id}/reschedule`)
            .set(authHeader(customer))
            .send({ appointmentDate: '2027-03-03', startTime: '10:00' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already taken place/i);
    });

    it('the same applies via the manage token', async () => {
        const { provider, service, customer } = await setup();
        provider.bookingPolicy = { cancellationWindowHours: 0 };
        await provider.save();
        const past = await apptAt(customer, service, provider, -48);
        const cancel = await request(app).post(`/api/appointments/manage/${past.manageToken}/cancel`);
        expect(cancel.status).toBe(400);
        expect(cancel.body.message).toMatch(/already taken place/i);
        const move = await request(app)
            .post(`/api/appointments/manage/${past.manageToken}/reschedule`)
            .send({ appointmentDate: '2027-03-03', startTime: '10:00' });
        expect(move.status).toBe(400);
    });
});

describe('manage-token (no-login) paths', () => {
    it('enforces the window on token cancel and token reschedule', async () => {
        const { provider, service, customer } = await setup();
        const inside = await apptAt(customer, service, provider, 5);

        const cancel = await request(app).post(`/api/appointments/manage/${inside.manageToken}/cancel`);
        expect(cancel.status).toBe(400);
        expect(cancel.body.message).toMatch(/24 hours notice/i);

        const move = await request(app)
            .post(`/api/appointments/manage/${inside.manageToken}/reschedule`)
            .send({ appointmentDate: '2027-03-03', startTime: '10:00' });
        expect(move.status).toBe(400);

        const outside = await apptAt(customer, service, provider, 48);
        const ok = await request(app).post(`/api/appointments/manage/${outside.manageToken}/cancel`);
        expect(ok.status).toBe(200);
    });

    it('exposes the window on the manage view', async () => {
        const { provider, service, customer } = await setup();
        const appt = await apptAt(customer, service, provider, 48);
        const res = await request(app).get(`/api/appointments/manage/${appt.manageToken}`);
        expect(res.status).toBe(200);
        expect(res.body.data.cancellationWindowHours).toBe(24);
    });
});

describe('provider settings (PUT /api/auth/profile)', () => {
    it('providers can set the window; junk values are rejected', async () => {
        const { provider } = await setup();
        const ok = await request(app).put('/api/auth/profile').set(authHeader(provider))
            .send({ cancellationWindowHours: 12 });
        expect(ok.status).toBe(200);
        expect(ok.body.data.bookingPolicy.cancellationWindowHours).toBe(12);

        for (const bad of [-1, 500, 1.5, 'soon']) {
            const res = await request(app).put('/api/auth/profile').set(authHeader(provider))
                .send({ cancellationWindowHours: bad });
            expect(res.status).toBe(400);
        }
    });

    it('the public provider profile advertises the window', async () => {
        const { provider } = await setup();
        await makeService(provider._id); // profile needs at least the provider to resolve
        const res = await request(app).get(`/api/providers/${provider._id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.provider.cancellationWindowHours).toBe(24);
    });
});
