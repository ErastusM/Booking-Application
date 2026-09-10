/**
 * Permission tiers — Phase 2b: a Medium staff member may book on behalf of an
 * EXISTING client of their business (isStaffOnBehalf in createAppointment).
 *
 * The guarantees under test: the client-attach is gated on a Medium-only
 * capability (clients:view) so Low walk-in staff can't reach it; the "existing
 * client" check keys on the EMPLOYER (staffOf), so a staff member can't attach —
 * or read the contact details of — an arbitrary platform account or another
 * business's client; and the booking is still held to the customer guards (no
 * back-dating), i.e. it is NOT an owner override.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

let seq = 0;
const makeStaff = async (provider, tier) => {
    seq += 1;
    const login = await makeUser({ role: 'staff', staffOf: provider._id, email: `staff-${tier}-${seq}@test.com`, staffTier: tier });
    await TeamMember.create({ provider: provider._id, name: `Staff ${tier} ${seq}`, role: 'Reception', user: login._id });
    return login;
};

const weekday = () => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// A registered client of `provider`: a customer with a past booking there.
const makeClientOf = async (provider, service) => {
    const client = await makeUser();
    await makeAppointment(client._id, service._id, provider._id, { status: 'completed' });
    return client;
};

const book = (user, body) => request(app).post('/api/appointments').set(authHeader(user)).send(body);
const onBehalf = (extra) => ({ appointmentDate: weekday(), startTime: '14:00', endTime: '14:30', ...extra });

describe('Medium staff book-on-behalf', () => {
    it('books an existing client of the business (customer attached, not the staff)', async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);
        const medium = await makeStaff(provider, 'medium');
        const client = await makeClientOf(provider, service);

        const res = await book(medium, onBehalf({ service: service._id.toString(), customerId: client._id.toString() }));
        expect(res.status).toBe(201);
        // customer comes back populated in the create response.
        expect(String(res.body.data.customer?._id || res.body.data.customer)).toBe(String(client._id));
        expect(res.body.data.walkInName).toBeNull();
    });

    it('refuses a stranger who never booked the business', async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);
        const medium = await makeStaff(provider, 'medium');
        const stranger = await makeUser(); // no booking with this business

        const res = await book(medium, onBehalf({ service: service._id.toString(), customerId: stranger._id.toString() }));
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/existing client/i);
    });

    it('a Low staff member cannot book on behalf — customerId is ignored, they book themselves', async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);
        const low = await makeStaff(provider, 'low'); // has bookings:create but NOT clients:view
        const client = await makeClientOf(provider, service);

        const res = await book(low, onBehalf({ service: service._id.toString(), customerId: client._id.toString() }));
        expect(res.status).toBe(201);
        // The booking was NOT attached to the client — it's the staff member's own.
        const bookedCustomer = String(res.body.data.customer?._id || res.body.data.customer);
        expect(bookedCustomer).not.toBe(String(client._id));
        expect(bookedCustomer).toBe(String(low._id));
    });

    it("cannot attach another business's client (existence check keys on staffOf)", async () => {
        const businessA = await makeProvider();
        const serviceA = await makeService(businessA._id);
        const clientOfA = await makeClientOf(businessA, serviceA);

        const businessB = await makeProvider();
        const serviceB = await makeService(businessB._id);
        const mediumOfB = await makeStaff(businessB, 'medium');

        // Medium of B tries to book B's service for a client who only ever booked A.
        const res = await book(mediumOfB, onBehalf({ service: serviceB._id.toString(), customerId: clientOfA._id.toString() }));
        expect(res.status).toBe(403);
    });

    it('is held to the past-slot guard — no back-dating an on-behalf booking', async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);
        const medium = await makeStaff(provider, 'medium');
        const client = await makeClientOf(provider, service);

        const res = await book(medium, onBehalf({ service: service._id.toString(), customerId: client._id.toString(), appointmentDate: '2020-01-06' }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already passed/i);
    });
});
