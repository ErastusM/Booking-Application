/**
 * Waiting-list promotion → customer celebration flow, and the provider-notified
 * -on-join behaviour.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const Notification = require('../../models/Notification');
const WaitingList = require('../../models/WaitingList');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduledClient: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
}));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const soon = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('Waiting list', () => {
    it('notifies the provider (in-app) when a customer joins', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const booker = await makeUser();
        const waiter = await makeUser();
        const date = soon();

        // Booker takes the slot.
        await request(app).post('/api/appointments').set(authHeader(booker))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30' });

        // Waiter joins the (now taken) slot's waiting list.
        const join = await request(app).post('/api/waitinglist').set(authHeader(waiter))
            .send({ service: svc._id.toString(), provider: provider._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30' });
        expect(join.status).toBe(201);

        const provNotifs = await Notification.find({ user: provider._id, type: 'waiting_list' });
        expect(provNotifs.length).toBeGreaterThan(0);
    });

    it('promotes the next waiter on cancellation and surfaces a pending celebration', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const booker = await makeUser();
        const waiter = await makeUser();
        const date = soon();

        const booked = await request(app).post('/api/appointments').set(authHeader(booker))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '11:00', endTime: '11:30' });
        const apptId = booked.body.data._id;

        await request(app).post('/api/waitinglist').set(authHeader(waiter))
            .send({ service: svc._id.toString(), provider: provider._id.toString(), appointmentDate: date, startTime: '11:00', endTime: '11:30' });

        // Booker cancels → the waiter should be promoted into the freed slot.
        const cancel = await request(app).delete(`/api/appointments/${apptId}`).set(authHeader(booker))
            .send({ cancellationReason: 'changed my mind' });
        expect(cancel.status).toBe(200);

        const entry = await WaitingList.findOne({ customer: waiter._id });
        expect(entry.status).toBe('promoted');

        // The customer app sees a pending celebration...
        const pending = await request(app).get('/api/waitinglist/promotions/pending').set(authHeader(waiter));
        expect(pending.status).toBe(200);
        expect(pending.body.data.length).toBe(1);
        const promoId = pending.body.data[0]._id;

        // ...marks it shown...
        const ack = await request(app).post(`/api/waitinglist/promotions/${promoId}/celebrated`).set(authHeader(waiter));
        expect(ack.status).toBe(200);

        // ...and it doesn't fire again.
        const again = await request(app).get('/api/waitinglist/promotions/pending').set(authHeader(waiter));
        expect(again.body.data.length).toBe(0);
    });

    it('only the owning customer can mark a promotion celebrated', async () => {
        const waiter = await makeUser();
        const other = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const entry = await WaitingList.create({
            service: svc._id, provider: provider._id, customer: waiter._id,
            appointmentDate: new Date(soon()), startTime: '12:00', endTime: '12:30',
            position: 1, status: 'promoted',
        });

        // A different user's ack must not clear it.
        await request(app).post(`/api/waitinglist/promotions/${entry._id}/celebrated`).set(authHeader(other));
        const still = await request(app).get('/api/waitinglist/promotions/pending').set(authHeader(waiter));
        expect(still.body.data.length).toBe(1);
    });
});
