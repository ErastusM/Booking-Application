/**
 * Permission tiers — Phase 2b: a Medium staff member may book on behalf of an
 * EXISTING client of their business (isStaffOnBehalf in createAppointment).
 *
 * The guarantees under test: attaching ANY client of the business is gated on
 * a Medium capability (clients:view) — a Low (Service provider) member may only
 * book the clients they personally serve, into their own column (see
 * staffBookOwnClients.test.js); the "existing
 * client" check keys on the EMPLOYER (staffOf), so a staff member can't attach —
 * or read the contact details of — an arbitrary platform account or another
 * business's client; and the booking is still held to the customer guards (no
 * back-dating), i.e. it is NOT an owner override.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');
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

    it("a Low staff member cannot book a business client they don't serve — refused, and nothing is booked in their own name", async () => {
        const provider = await makeProvider();
        const service = await makeService(provider._id);
        const low = await makeStaff(provider, 'low'); // bookings:create, but NOT clients:view
        // makeClientOf's booking has no teamMember — the owner's client, not one
        // this member serves, so it is outside their clients:assigned scope.
        const client = await makeClientOf(provider, service);
        const before = await Appointment.countDocuments({});

        const res = await book(low, onBehalf({ service: service._id.toString(), customerId: client._id.toString() }));
        // It used to fall through and book the STAFF MEMBER as the client, silently
        // dropping the client they picked. Now it's refused with the reason.
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('staff_booking_not_allowed');
        expect(res.body.message).toMatch(/clients you serve/i);
        expect(await Appointment.countDocuments({})).toBe(before);
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
