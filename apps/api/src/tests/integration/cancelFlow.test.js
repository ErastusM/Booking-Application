/**
 * Cancellation flow, end to end:
 *   1. The 24h notice window is gone — a client can cancel a booking that starts soon
 *      (previously rejected with 400, leaving it CONFIRMED on the business calendar).
 *   2. The business is notified when a client cancels.
 *   3. Cancelling frees the slot to the waiting list, the promoted client is notified,
 *      and the business is told the slot was refilled.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');
const Notification = require('../../models/Notification');
const WaitingList = require('../../models/WaitingList');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// TOMORROW — deliberately inside the old 24h window on most clock times.
const soon = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const book = (customer, svc, date, startTime = '10:00', endTime = '10:30') =>
    request(app).post('/api/appointments').set(authHeader(customer))
        .send({ service: svc._id.toString(), appointmentDate: date, startTime, endTime });

describe('client cancellation', () => {
    it('is no longer blocked by a notice window, even for a booking starting soon', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const customer = await makeUser();
        const date = soon();

        const b = await book(customer, svc, date);
        expect(b.status).toBe(201);

        const res = await request(app).delete(`/api/appointments/${b.body.data._id}`)
            .set(authHeader(customer)).send({ cancellationReason: 'changed my mind' });

        expect(res.status).toBe(200); // was 400 "requires at least 24 hours notice"
        const after = await Appointment.findById(b.body.data._id);
        expect(after.status).toBe('cancelled'); // so it leaves the business calendar
    });

    it('notifies the business that the client cancelled', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const customer = await makeUser();

        const b = await book(customer, svc, soon());
        await request(app).delete(`/api/appointments/${b.body.data._id}`)
            .set(authHeader(customer)).send({});

        const notes = await Notification.find({ user: provider._id });
        expect(notes.some(n => /cancelled/i.test(n.message))).toBe(true);
    });

    it('promotes the next waitlisted client into the freed slot and tells both sides', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const customer = await makeUser();
        const waiter = await makeUser();
        const date = soon();

        const b = await book(customer, svc, date);
        expect(b.status).toBe(201);

        // Someone queues for the now-taken slot.
        const join = await request(app).post('/api/waitinglist').set(authHeader(waiter))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30' });
        expect([200, 201]).toContain(join.status);

        await request(app).delete(`/api/appointments/${b.body.data._id}`)
            .set(authHeader(customer)).send({});

        // The waiter now holds a real confirmed booking in that slot.
        const promoted = await Appointment.findOne({ customer: waiter._id, status: 'confirmed' });
        expect(promoted).not.toBeNull();
        expect(promoted.startTime).toBe('10:00');

        const entry = await WaitingList.findOne({ customer: waiter._id });
        expect(entry.status).toBe('promoted');

        // The promoted client was told...
        const waiterNotes = await Notification.find({ user: waiter._id });
        expect(waiterNotes.some(n => /slot opened up/i.test(n.message))).toBe(true);

        // ...and so was the business.
        const providerNotes = await Notification.find({ user: provider._id });
        expect(providerNotes.some(n => /refilled|waiting list/i.test(n.message))).toBe(true);
    });
});
