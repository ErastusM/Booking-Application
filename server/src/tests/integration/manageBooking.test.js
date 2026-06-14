/**
 * No-login "manage my booking" via opaque token.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const nextWeekday = () => {
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function createBooking() {
    const provider = await makeProvider();
    const svc = await makeService(provider._id, { duration: 30 });
    const res = await request(app)
        .post('/api/appointments')
        .set(authHeader(provider))
        .send({ service: svc._id.toString(), appointmentDate: nextWeekday(), startTime: '10:00', endTime: '10:30', walkInName: 'Guest' });
    return res.body.data;
}

describe('Manage booking via token (no auth)', () => {
    it('returns a guest-safe booking view with no token/auth', async () => {
        const appt = await createBooking();
        const res = await request(app).get(`/api/appointments/manage/${appt.manageToken}`);
        expect(res.status).toBe(200);
        expect(res.body.data.service.name).toBeTruthy();
        expect(res.body.data.startTime).toBe('10:00');
        // must not leak internal fields
        expect(res.body.data.manageToken).toBeUndefined();
        expect(res.body.data.customer).toBeUndefined();
    });

    it('cancels a booking via token', async () => {
        const appt = await createBooking();
        const res = await request(app).post(`/api/appointments/manage/${appt.manageToken}/cancel`);
        expect(res.status).toBe(200);
        const after = await request(app).get(`/api/appointments/manage/${appt.manageToken}`);
        expect(after.body.data.status).toBe('cancelled');
    });

    it('404s for an unknown token', async () => {
        const res = await request(app).get('/api/appointments/manage/not-a-real-token');
        expect(res.status).toBe(404);
    });

    it('refuses to cancel an already-cancelled booking', async () => {
        const appt = await createBooking();
        await request(app).post(`/api/appointments/manage/${appt.manageToken}/cancel`);
        const again = await request(app).post(`/api/appointments/manage/${appt.manageToken}/cancel`);
        expect(again.status).toBe(400);
    });
});
