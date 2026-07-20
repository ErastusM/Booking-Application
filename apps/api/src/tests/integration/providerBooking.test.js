/**
 * Regression: provider creating an appointment from the calendar must not 500.
 * Root cause was email (EAUTH on bad Gmail creds) propagating into the request
 * path; emailService.safeSend now isolates that. A failing/absent mailer must
 * never break booking.
 */
const request = require('supertest');

// Simulate a broken mailer (e.g. EAUTH on bad Gmail creds). Booking must still succeed.
jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendWelcomeEmail: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendAppointmentConfirmed: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendAppointmentCompleted: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendAppointmentCancelled: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendAppointmentRescheduled: jest.fn().mockRejectedValue(new Error('EAUTH')),
    sendRebookingPrompt: jest.fn().mockRejectedValue(new Error('EAUTH')),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService, makeUser, makeAppointment, authHeader } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const nextWeekday = () => {
    const d = new Date();
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('Provider creates an appointment from the calendar', () => {
    it('creates a walk-in appointment (no 500)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(provider))
            .send({
                service: svc._id.toString(),
                appointmentDate: nextWeekday(),
                startTime: '10:00',
                endTime: '10:30',
                walkInName: 'Walk-in Client',
                notes: '',
                isRecurring: false,
            });
        expect(res.status).toBe(201);
        expect(res.body.data.walkInName).toBe('Walk-in Client');
    });

    it('creates a custom recurring series (every 2 weeks)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const start = nextWeekday();
        const [y, m, d] = start.split('-').map(Number);
        const endDt = new Date(Date.UTC(y, m - 1, d)); endDt.setUTCDate(endDt.getUTCDate() + 42); // ~6 weeks
        const pad = (n) => String(n).padStart(2, '0');
        const end = `${endDt.getUTCFullYear()}-${pad(endDt.getUTCMonth() + 1)}-${pad(endDt.getUTCDate())}`;

        const res = await request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: start, startTime: '10:00', endTime: '10:30',
            walkInName: 'Recurring Client', isRecurring: true, recurrenceType: 'weekly', recurrenceInterval: 2, recurrenceEndDate: end,
        });
        expect(res.status).toBe(201);

        const series = await Appointment.find({ recurrenceGroupId: res.body.data.recurrenceGroupId }).sort({ appointmentDate: 1 });
        expect(series.length).toBeGreaterThanOrEqual(3); // every 2 weeks across ~6 weeks
        expect(series[0].recurrenceInterval).toBe(2);
        const gapDays = Math.round((new Date(series[1].appointmentDate) - new Date(series[0].appointmentDate)) / 86400000);
        expect(gapDays).toBe(14);
    });

    it('books an existing registered client (customerId) — appointment is for the client, not the provider', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const client = await makeUser({ name: 'Existing Client', email: 'existing@test.com' });
        // Book-on-behalf is only allowed for a real client of this provider — one who
        // has booked before (the dashboard's client list is built from past bookings).
        // A far-past appointment establishes the relationship without conflicting.
        await makeAppointment(client._id, svc._id, provider._id, {
            appointmentDate: new Date('2020-01-15T00:00:00Z'), startTime: '08:00', endTime: '08:30',
        });

        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(provider))
            .send({
                service: svc._id.toString(),
                appointmentDate: nextWeekday(),
                startTime: '11:00',
                endTime: '11:30',
                customerId: client._id.toString(),
            });

        expect(res.status).toBe(201);
        // The booking belongs to the chosen client, with no walk-in name
        expect(res.body.data.customer._id).toBe(client._id.toString());
        expect(res.body.data.walkInName).toBeNull();
    });

    it('returns 404 when booking a customerId that does not exist', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const res = await request(app)
            .post('/api/appointments')
            .set(authHeader(provider))
            .send({
                service: svc._id.toString(),
                appointmentDate: nextWeekday(),
                startTime: '12:00',
                endTime: '12:30',
                customerId: '64b7f0000000000000000000', // valid ObjectId, no such user
            });
        expect(res.status).toBe(404);
    });

    it('creates a group booking for multiple walk-in clients (no 500)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const res = await request(app)
            .post('/api/appointments/group')
            .set(authHeader(provider))
            .send({
                service: svc._id.toString(),
                appointmentDate: nextWeekday(),
                startTime: '14:00',
                endTime: '14:30',
                clients: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
            });

        expect(res.status).toBe(201);
        expect(res.body.data).toHaveLength(3);
        // Name-only group clients are walk-ins → owned by the provider (customer is
        // required on the model; null here used to 500 the whole request).
        expect(res.body.data.every(a => a.customer === provider._id.toString())).toBe(true);
        expect(res.body.data.map(a => a.walkInName)).toEqual(['Alice', 'Bob', 'Carol']);
        // All appointments in the group share one groupId.
        expect(new Set(res.body.data.map(a => a.groupId)).size).toBe(1);
    });
});
