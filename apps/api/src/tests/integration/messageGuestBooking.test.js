/**
 * Robustness: sending a message on a GUEST booking (no customer account) used to
 * dereference `appointment.customer.toString()` on a null customer and crash with
 * a 500. A guest has no account to receive an in-app message, so the provider
 * should get a clean 400 ("no recipient"), never a server error.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

it('a provider messaging a guest booking gets 400, not a 500 crash', async () => {
    const provider = await makeProvider();
    const svc = await makeService(provider._id);
    // Guest booking: no customer account, contactable only by email.
    const appt = await makeAppointment(null, svc._id, provider._id, {
        customer: null,
        guestName: 'Walk-up Guest',
        guestEmail: 'guest@test.com',
    });

    const res = await request(app)
        .post(`/api/messages/${appt._id}`)
        .set(authHeader(provider))
        .send({ content: 'Hi, see you soon' });

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
});
