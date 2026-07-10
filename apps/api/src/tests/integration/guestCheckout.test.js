/**
 * Guest checkout — a first-time visitor can book without an account.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeAdmin, makeService, authHeader } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A weekday a few days out (future, avoids weekend availability + past-slot checks).
const soon = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const bookingBody = (svc, extra = {}) => ({
    service: svc._id.toString(),
    appointmentDate: soon(),
    startTime: '10:00',
    endTime: '10:30',
    ...extra,
});

describe('POST /api/appointments — guest checkout', () => {
    it('lets an unauthenticated visitor book with contact details', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const res = await request(app)
            .post('/api/appointments')
            .send(bookingBody(svc, { guestName: 'Jane Doe', guestEmail: 'JANE@example.com', guestPhone: '+264811234567' }));

        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe('confirmed');
        expect(res.body.data.customer).toBeNull();
        expect(res.body.data.guestName).toBe('Jane Doe');
        expect(res.body.data.guestEmail).toBe('jane@example.com'); // lowercased by the schema
        expect(res.body.data.manageToken).toBeTruthy();
        expect(res.body.data.paymentMethod).toBe('cash');
    });

    it('rejects a guest booking with no name/email (400)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const res = await request(app).post('/api/appointments').send(bookingBody(svc));
        expect(res.status).toBe(400);
    });

    it('rejects an invalid guest email (400)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const res = await request(app)
            .post('/api/appointments')
            .send(bookingBody(svc, { guestName: 'Jane', guestEmail: 'not-an-email' }));
        expect(res.status).toBe(400);
    });

    it('still creates a normal booking for an authenticated customer (no guest fields)', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(customer))
            .send(bookingBody(svc));

        expect(res.status).toBe(201);
        const customerId = res.body.data.customer?._id || res.body.data.customer;
        expect(customerId.toString()).toBe(customer._id.toString());
        expect(res.body.data.guestEmail).toBeNull();
    });

    it('lets a guest manage their booking via the token (no login)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const created = await request(app)
            .post('/api/appointments')
            .send(bookingBody(svc, { guestName: 'Sam', guestEmail: 'sam@example.com' }));
        const token = created.body.data.manageToken;

        const managed = await request(app).get(`/api/appointments/manage/${token}`);
        expect(managed.status).toBe(200);
    });

    it('blocks guest checkout when the business requires wallet prepayment', async () => {
        const provider = await makeProvider({ walletSettings: { enabled: true, bookingPaymentMode: 'wallet_required' } });
        const svc = await makeService(provider._id);

        const res = await request(app)
            .post('/api/appointments')
            .send(bookingBody(svc, { guestName: 'Jane', guestEmail: 'jane@example.com' }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/account/i);
    });

    it('does not let an admin create a booking from this endpoint (403)', async () => {
        const admin = await makeAdmin();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const res = await request(app).post('/api/appointments').set(authHeader(admin)).send(bookingBody(svc));
        expect(res.status).toBe(403);
    });

    it('lets a guest cancel their booking via the token, no login', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const created = await request(app)
            .post('/api/appointments')
            .send(bookingBody(svc, { guestName: 'Cathy', guestEmail: 'cathy@example.com' }));
        const token = created.body.data.manageToken;

        const cancelled = await request(app).post(`/api/appointments/manage/${token}/cancel`);
        expect(cancelled.status).toBe(200);
        const appt = await Appointment.findById(created.body.data._id);
        expect(appt.status).toBe('cancelled');
    });

    it('persists the appointment with a null customer + guest fields in the DB', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);

        const res = await request(app)
            .post('/api/appointments')
            .send(bookingBody(svc, { guestName: 'Guest Person', guestEmail: 'guest@example.com' }));

        const appt = await Appointment.findById(res.body.data._id);
        expect(appt.customer).toBeNull();
        expect(appt.guestEmail).toBe('guest@example.com');
        expect(appt.guestName).toBe('Guest Person');
    });
});
