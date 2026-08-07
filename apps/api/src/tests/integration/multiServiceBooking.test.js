/**
 * Provider-built multi-service booking (POST /api/appointments/multi): several of
 * the provider's own services stacked back-to-back in one appointment, summed
 * total, provider-owned + existing-client guards.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const setup = async () => {
    const provider = await makeProvider();
    const svcA = await makeService(provider._id, { name: 'Cut', price: 200, duration: 60 });
    const svcB = await makeService(provider._id, { name: 'Beard', price: 100, duration: 30 });
    const client = await makeUser();
    // Make `client` an existing client of this provider (prior booking).
    await makeAppointment(client._id, svcA._id, provider._id, { status: 'completed' });
    return { provider, svcA, svcB, client };
};

const book = (provider, body) =>
    request(app).post('/api/appointments/multi').set(authHeader(provider)).send(body);

describe('POST /api/appointments/multi', () => {
    it('stacks services back-to-back with a summed total and full span', async () => {
        const { provider, svcA, svcB, client } = await setup();
        const res = await book(provider, {
            appointmentDate: '2027-03-03', startTime: '10:00',
            customerId: client._id.toString(),
            services: [{ serviceId: svcA._id.toString() }, { serviceId: svcB._id.toString() }],
        });
        expect(res.status).toBe(201);
        const appt = res.body.data;
        expect(appt.services).toHaveLength(2);
        expect(appt.totalPrice).toBe(300);          // 200 + 100
        expect(appt.startTime).toBe('10:00');
        expect(appt.endTime).toBe('11:30');          // 60 + 30 min
        expect(appt.services[0].endTime).toBe('11:00');
        expect(appt.services[1].startTime).toBe('11:00');
    });

    it("rejects a service the provider doesn't own", async () => {
        const { provider, svcA, client } = await setup();
        const other = await makeProvider();
        const foreign = await makeService(other._id, { name: 'Spa', price: 50, duration: 30 });
        const res = await book(provider, {
            appointmentDate: '2027-03-03', startTime: '10:00',
            customerId: client._id.toString(),
            services: [{ serviceId: svcA._id.toString() }, { serviceId: foreign._id.toString() }],
        });
        expect(res.status).toBe(403);
    });

    it('rejects booking on behalf of a non-client', async () => {
        const { provider, svcA } = await setup();
        const stranger = await makeUser();
        const res = await book(provider, {
            appointmentDate: '2027-03-03', startTime: '10:00',
            customerId: stranger._id.toString(),
            services: [{ serviceId: svcA._id.toString() }],
        });
        expect(res.status).toBe(403);
    });

    it('allows a walk-in (no customerId) with a name', async () => {
        const { provider, svcA, svcB } = await setup();
        const res = await book(provider, {
            appointmentDate: '2027-03-03', startTime: '09:00', walkInName: 'Jane Doe',
            services: [{ serviceId: svcA._id.toString() }, { serviceId: svcB._id.toString() }],
        });
        expect(res.status).toBe(201);
        expect(res.body.data.walkInName).toBe('Jane Doe');
        expect(res.body.data.totalPrice).toBe(300);
    });

    it('is provider-only', async () => {
        const { svcA, client } = await setup();
        const res = await request(app).post('/api/appointments/multi').set(authHeader(client)).send({
            appointmentDate: '2027-03-03', startTime: '10:00',
            services: [{ serviceId: svcA._id.toString() }],
        });
        expect(res.status).toBe(403);
    });
});
