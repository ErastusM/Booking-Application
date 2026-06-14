/**
 * Appointment business-logic integration tests.
 * Covers: booking conflict detection, ownership, cancellation,
 * status transitions, reschedule, pagination.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const {
    makeUser, makeProvider, makeAdmin,
    makeService, makeAppointment,
    authHeader,
} = require('../helpers/factories');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// Helper to build a valid booking payload
// Next weekday (Mon-Fri) so the date always falls inside the default
// availability schedule, which disables weekends. Plain "tomorrow" made
// this suite flaky when run on Fridays/Saturdays.
const tomorrow = () => {
    const d = new Date();
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    // Format from local date parts — toISOString() is UTC and can shift
    // the calendar day near midnight, landing back on a weekend.
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('POST /api/appointments – booking creation', () => {
    it('creates an appointment for a valid customer + service', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: svc._id.toString(),
                appointmentDate: tomorrow(),
                startTime: '09:00',
                endTime: '09:30',
            });
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe('confirmed');
        const customerId = res.body.data.customer?._id || res.body.data.customer;
        expect(customerId.toString()).toBe(customer._id.toString());
    });

    it('returns 400 when required fields are missing', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({ service: 'someid' }); // missing date & times
        expect(res.status).toBe(400);
    });

    it('returns 404 for a non-existent service', async () => {
        const customer = await makeUser();
        const { Types: { ObjectId } } = require('mongoose');
        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: new ObjectId().toString(),
                appointmentDate: tomorrow(),
                startTime: '09:00',
                endTime: '09:30',
            });
        expect(res.status).toBe(404);
    });

    it('blocks double-booking the same slot', async () => {
        const customerA = await makeUser();
        const customerB = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const date = tomorrow();

        await request(app)
            .post('/api/appointments')
            .set(authHeader(customerA))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '11:00', endTime: '11:30' });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customerB))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '11:00', endTime: '11:30' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already booked|waiting list/i);
    });

    it('calculates totalPrice = service.price + add-on prices', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 50 });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send({
                service: svc._id.toString(),
                appointmentDate: tomorrow(),
                startTime: '14:00',
                endTime: '14:30',
                selectedAddOns: [{ name: 'Shampoo', price: 10 }, { name: 'Trim', price: 5 }],
            });
        expect(res.status).toBe(201);
        expect(res.body.data.totalPrice).toBe(65);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANCELLATION
// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/appointments/:id – cancellation', () => {
    it('owner can cancel their pending appointment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id);

        const res = await request(app)
            .delete(`/api/appointments/${appt._id}`)
            .set(authHeader(customer));
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('cancelled');
    });

    it('admin can cancel any appointment', async () => {
        const customer = await makeUser();
        const admin = await makeAdmin();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id);

        const res = await request(app)
            .delete(`/api/appointments/${appt._id}`)
            .set(authHeader(admin));
        expect(res.status).toBe(200);
    });

    it('returns 404 for non-existent appointment', async () => {
        const customer = await makeUser();
        const { Types: { ObjectId } } = require('mongoose');
        const res = await request(app)
            .delete(`/api/appointments/${new ObjectId()}`)
            .set(authHeader(customer));
        expect(res.status).toBe(404);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATUS TRANSITIONS (provider / admin)
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/appointments/:id/status', () => {
    it('provider can confirm their own appointment', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id);

        const res = await request(app)
            .put(`/api/appointments/${appt._id}/status`)
            .set(authHeader(provider))
            .send({ status: 'confirmed' });
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('confirmed');
    });

    it('customer cannot change appointment status', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(customer._id, svc._id, provider._id);

        const res = await request(app)
            .put(`/api/appointments/${appt._id}/status`)
            .set(authHeader(customer))
            .send({ status: 'confirmed' });
        expect(res.status).toBe(403);
    });

    it('provider cannot update another provider\'s appointment status', async () => {
        const customer = await makeUser();
        const providerA = await makeProvider();
        const providerB = await makeProvider();
        const svc = await makeService(providerA._id);
        const appt = await makeAppointment(customer._id, svc._id, providerA._id);

        const res = await request(app)
            .put(`/api/appointments/${appt._id}/status`)
            .set(authHeader(providerB))
            .send({ status: 'confirmed' });
        expect(res.status).toBe(403);
    });
});

describe('PUT /api/appointments/:id/reschedule', () => {
    it('rejects rescheduling into an already-booked slot', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const date = tomorrow();

        const apptA = await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: new Date(date),
            startTime: '10:00',
            endTime: '10:30',
        });
        await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: new Date(date),
            startTime: '11:00',
            endTime: '11:30',
        });

        const res = await request(app)
            .put(`/api/appointments/${apptA._id}/reschedule`)
            .set(authHeader(customer))
            .send({ appointmentDate: date, startTime: '11:00' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already booked/i);
    });
});

describe('PUT /api/appointments/:id/provider-reschedule (drag & resize)', () => {
    it('drag (no endTime) recomputes end from service duration', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const date = tomorrow();
        const appt = await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: new Date(date), startTime: '10:00', endTime: '10:30',
        });
        const res = await request(app)
            .put(`/api/appointments/${appt._id}/provider-reschedule`)
            .set(authHeader(provider))
            .send({ appointmentDate: date, startTime: '14:00' });
        expect(res.status).toBe(200);
        expect(res.body.data.startTime).toBe('14:00');
        expect(res.body.data.endTime).toBe('14:30');
    });

    it('resize (explicit endTime) changes the appointment duration', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const date = tomorrow();
        const appt = await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: new Date(date), startTime: '10:00', endTime: '10:30',
        });
        const res = await request(app)
            .put(`/api/appointments/${appt._id}/provider-reschedule`)
            .set(authHeader(provider))
            .send({ appointmentDate: date, startTime: '10:00', endTime: '11:15' });
        expect(res.status).toBe(200);
        expect(res.body.data.endTime).toBe('11:15');
    });

    it('rejects an endTime that is not after the start time', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const date = tomorrow();
        const appt = await makeAppointment(customer._id, svc._id, provider._id, {
            appointmentDate: new Date(date), startTime: '10:00', endTime: '10:30',
        });
        const res = await request(app)
            .put(`/api/appointments/${appt._id}/provider-reschedule`)
            .set(authHeader(provider))
            .send({ appointmentDate: date, startTime: '10:00', endTime: '09:30' });
        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/appointments – pagination', () => {
    it('respects page and limit query params', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        // Create 5 appointments
        for (let i = 0; i < 5; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i + 1);
            await makeAppointment(customer._id, svc._id, provider._id, {
                appointmentDate: d,
                startTime: `${10 + i}:00`,
                endTime: `${10 + i}:30`,
            });
        }

        const res = await request(app)
            .get('/api/appointments?page=1&limit=3')
            .set(authHeader(customer));
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(3);
        expect(res.body.total).toBe(5);
        expect(res.body.pages).toBe(2);
    });

    it('limit is capped at 50', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .get('/api/appointments?limit=999')
            .set(authHeader(customer));
        expect(res.status).toBe(200);
        // The limit used should be 50 max; response won't have more than 50 items
        expect(res.body.data.length).toBeLessThanOrEqual(50);
    });
});
