/**
 * Regression cover for high-severity QA findings handled server-side in the
 * appointment controller:
 *   #7  updateAppointmentStatus re-activated a cancelled booking into a re-sold slot
 *   #9  createAppointment trusted client-supplied customerId (book for / read any user)
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A weekday N days out (skips weekends so it stays inside default availability).
const weekdayAhead = (n) => {
    const d = new Date();
    let added = 0;
    while (added < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) added++; }
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

describe('#9 — provider book-on-behalf requires an existing client', () => {
    it('rejects booking for a customer who has never booked this provider', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const stranger = await makeUser();
        const res = await request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: weekdayAhead(5),
            startTime: '10:00', endTime: '10:30', customerId: stranger._id.toString(),
        });
        expect(res.status).toBe(403);
    });

    it('allows booking for a returning client and books it to them', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const client = await makeUser();
        await makeAppointment(client._id, svc._id, provider._id); // establishes the relationship
        const res = await request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: svc._id.toString(), appointmentDate: weekdayAhead(10),
            startTime: '11:00', endTime: '11:30', customerId: client._id.toString(),
        });
        expect(res.status).toBe(201);
        const custId = res.body.data.customer?._id || res.body.data.customer;
        expect(String(custId)).toBe(String(client._id));
    });
});

describe('#7 — a cancelled booking can’t be revived into a re-sold slot', () => {
    it('rejects reinstating a cancelled appointment whose slot was rebooked', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const c1 = await makeUser();
        const c2 = await makeUser();
        const date = weekdayAhead(6);

        const a = await request(app).post('/api/appointments').set(authHeader(c1))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30' });
        expect(a.status).toBe(201);

        // Provider cancels it → frees the slot (and would promote any waitlist).
        const cancel = await request(app).put(`/api/appointments/${a.body.data._id}/status`)
            .set(authHeader(provider)).send({ status: 'cancelled' });
        expect(cancel.status).toBe(200);

        // A second client takes the now-free slot.
        const b = await request(app).post('/api/appointments').set(authHeader(c2))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30' });
        expect(b.status).toBe(201);

        // Reviving the first booking must be refused — the slot is taken.
        const revive = await request(app).put(`/api/appointments/${a.body.data._id}/status`)
            .set(authHeader(provider)).send({ status: 'confirmed' });
        expect(revive.status).toBe(400);
    });

    it('still allows reinstating a cancelled appointment when the slot is free', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const c1 = await makeUser();
        const date = weekdayAhead(7);

        const a = await request(app).post('/api/appointments').set(authHeader(c1))
            .send({ service: svc._id.toString(), appointmentDate: date, startTime: '10:00', endTime: '10:30' });
        await request(app).put(`/api/appointments/${a.body.data._id}/status`).set(authHeader(provider)).send({ status: 'cancelled' });

        const revive = await request(app).put(`/api/appointments/${a.body.data._id}/status`)
            .set(authHeader(provider)).send({ status: 'confirmed' });
        expect(revive.status).toBe(200);
    });
});

describe('#8 — conflict check is per-staff, not provider-wide', () => {
    it('lets a booking reschedule onto a time another staff member holds', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const customer = await makeUser();
        const staffA = new mongoose.Types.ObjectId();
        const staffB = new mongoose.Types.ObjectId();
        const date = weekdayAhead(6);

        // Staff A's booking at 09:00 (owned by the customer, so they can reschedule it).
        const apptA = await makeAppointment(customer._id, svc._id, provider._id, {
            teamMember: staffA, appointmentDate: new Date(`${date}T00:00:00Z`), startTime: '09:00', endTime: '09:30',
        });
        // Staff B is busy at 10:00 — a DIFFERENT column.
        await makeAppointment(customer._id, svc._id, provider._id, {
            teamMember: staffB, appointmentDate: new Date(`${date}T00:00:00Z`), startTime: '10:00', endTime: '10:30',
        });

        // Move A to 10:00. A is free then; only B is busy. Provider-wide would 400.
        const res = await request(app).put(`/api/appointments/${apptA._id}/reschedule`)
            .set(authHeader(customer)).send({ appointmentDate: date, startTime: '10:00' });
        expect(res.status).toBe(200);
    });

    it('still rejects rescheduling onto the SAME staff member’s existing booking', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { duration: 30 });
        const customer = await makeUser();
        const staffA = new mongoose.Types.ObjectId();
        const date = weekdayAhead(8);

        const apptEarly = await makeAppointment(customer._id, svc._id, provider._id, {
            teamMember: staffA, appointmentDate: new Date(`${date}T00:00:00Z`), startTime: '09:00', endTime: '09:30',
        });
        await makeAppointment(customer._id, svc._id, provider._id, {
            teamMember: staffA, appointmentDate: new Date(`${date}T00:00:00Z`), startTime: '10:00', endTime: '10:30',
        });

        const res = await request(app).put(`/api/appointments/${apptEarly._id}/reschedule`)
            .set(authHeader(customer)).send({ appointmentDate: date, startTime: '10:00' });
        expect(res.status).toBe(400); // same staff, real conflict
    });
});
