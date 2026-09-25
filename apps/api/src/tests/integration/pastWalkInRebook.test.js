/**
 * A past walk-in picked from the New Appointment client list is booked BY NAME.
 *
 * GET /api/crm/clients lists a walk-in (no account) under the id
 * "walkin:<lowercased name>", and the business app's "Select a client" picker
 * shows that roster. The create endpoints only take a real user id as
 * customerId, so the app sends the walk-in's roster name as walkInName instead
 * (apps/business/src/utils/bookingClient.js). This pins both halves of that
 * contract: the walk-in id is refused as a customerId, and a booking by the
 * roster name files under the SAME walk-in client, for one service and for
 * several, with no duplicate row.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const Appointment = require('../../models/Appointment');
const { makeProvider, makeService, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A weekday two weeks out, as "YYYY-MM-DD" — never a date that goes stale.
const futureDay = () => {
    const d = new Date(Date.now() + 14 * 864e5);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const setup = async () => {
    const provider = await makeProvider();
    const cut = await makeService(provider._id, { name: 'Cut', price: 200, duration: 60 });
    const beard = await makeService(provider._id, { name: 'Beard', price: 100, duration: 30 });
    // Last week's walk-in, logged by the owner (customer = owner id + walkInName).
    await Appointment.create({
        customer: provider._id, service: cut._id, provider: provider._id,
        appointmentDate: new Date(Date.now() - 7 * 864e5), startTime: '11:00', endTime: '12:00',
        totalPrice: 200, status: 'completed', walkInName: 'Oom Clayton',
    });
    return { provider, cut, beard };
};

const walkInRows = async (provider) => {
    const res = await request(app).get('/api/crm/clients').set(authHeader(provider));
    expect(res.status).toBe(200);
    return res.body.data.filter((c) => c.isWalkIn);
};

describe('Booking a past walk-in picked from the client list', () => {
    it('refuses the roster id as a customerId (why the app sends the name)', async () => {
        const { provider, cut } = await setup();
        const [row] = await walkInRows(provider);
        expect(row.customer._id).toBe('walkin:oom clayton');

        const res = await request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: cut._id.toString(), appointmentDate: futureDay(), startTime: '10:00', endTime: '11:00',
            customerId: row.customer._id,
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Invalid client ID/);
    });

    it('files one-service and several-service bookings by the roster name under the same client', async () => {
        const { provider, cut, beard } = await setup();
        const [row] = await walkInRows(provider);
        const day = futureDay();

        const single = await request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: cut._id.toString(), appointmentDate: day, startTime: '09:00', endTime: '10:00',
            walkInName: row.customer.name,
        });
        expect(single.status).toBe(201);
        expect(single.body.data.walkInName).toBe('Oom Clayton');

        const multi = await request(app).post('/api/appointments/multi').set(authHeader(provider)).send({
            appointmentDate: day, startTime: '13:00', walkInName: row.customer.name,
            services: [{ serviceId: cut._id.toString() }, { serviceId: beard._id.toString() }],
        });
        expect(multi.status).toBe(201);
        expect(multi.body.data.walkInName).toBe('Oom Clayton');

        const after = await walkInRows(provider);
        expect(after).toHaveLength(1);
        expect(after[0].customer._id).toBe('walkin:oom clayton');
        expect(after[0].customer.name).toBe('Oom Clayton');
        expect(after[0].visits).toBe(3);
    });

    it('groups the lowercased name from the id (the app\'s fallback) under the same client too', async () => {
        const { provider, cut } = await setup();
        const res = await request(app).post('/api/appointments').set(authHeader(provider)).send({
            service: cut._id.toString(), appointmentDate: futureDay(), startTime: '15:00', endTime: '16:00',
            walkInName: 'oom clayton',
        });
        expect(res.status).toBe(201);

        const after = await walkInRows(provider);
        expect(after).toHaveLength(1);
        expect(after[0].customer._id).toBe('walkin:oom clayton');
        expect(after[0].visits).toBe(2);
    });
});
