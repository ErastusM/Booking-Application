/**
 * A "Service provider" (Low tier — and the default for a member nobody chose a
 * level for) runs their own calendar: they book walk-ins AND the existing clients
 * they personally serve, always into their OWN column.
 *
 * "Clients they serve" is exactly their clients:assigned scope — the bookings
 * they perform, top-level or as a multi-service segment (memberInvolvedFilter,
 * the same scope clientCRMController.buildClientScope lists for them). A client
 * outside it stays refused unless they hold clients:view (Medium+) or the
 * owner-granted clients:view_all add-on. An explicit 'basic' member is view-only
 * and books nothing.
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
// A staff login + roster row. `tier` undefined → the field is left at its
// default (null: nobody chose a level).
const makeStaff = async (provider, tier, { permissions = [], member = {} } = {}) => {
    seq += 1;
    const login = await makeUser({
        role: 'staff', staffOf: provider._id, email: `own-${seq}@test.com`,
        ...(tier !== undefined ? { staffTier: tier } : {}),
        staffPermissions: permissions,
    });
    const row = await TeamMember.create({ provider: provider._id, name: `Member ${seq}`, user: login._id, offersAllServices: true, ...member });
    return { login, member: row };
};

const weekday = (plus = 2) => {
    const d = new Date();
    d.setDate(d.getDate() + plus);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const book = (user, body) => request(app).post('/api/appointments').set(authHeader(user)).send(body);
const slot = (extra) => ({ appointmentDate: weekday(), startTime: '14:00', endTime: '14:30', ...extra });
const idOf = (v) => String(v?._id || v);

// A business with a Service provider (John, tier null), a colleague (Sarah),
// and three registered clients: one John served, one Sarah served, and one the
// owner served (no teamMember).
const setup = async ({ johnTier, johnPermissions } = {}) => {
    const provider = await makeProvider();
    const service = await makeService(provider._id);
    const john = await makeStaff(provider, johnTier, { permissions: johnPermissions });
    const sarah = await makeStaff(provider, 'low');
    const johnsClient = await makeUser({ name: 'Tomas Shikongo' });
    const sarahsClient = await makeUser({ name: 'Ndapewa Amutenya' });
    const ownersClient = await makeUser({ name: 'Petrina Shilongo' });
    await makeAppointment(johnsClient._id, service._id, provider._id, { status: 'completed', teamMember: john.member._id, startTime: '09:00', endTime: '09:30' });
    await makeAppointment(sarahsClient._id, service._id, provider._id, { status: 'completed', teamMember: sarah.member._id, startTime: '09:00', endTime: '09:30' });
    await makeAppointment(ownersClient._id, service._id, provider._id, { status: 'completed', startTime: '11:00', endTime: '11:30' });
    return { provider, service, john, sarah, johnsClient, sarahsClient, ownersClient };
};

describe('a member with no level chosen (Service provider default) books their own clients', () => {
    it('books a client they serve, into their own column, with the client attached', async () => {
        const { service, john, johnsClient } = await setup();
        const res = await book(john.login, slot({ service: service._id.toString(), customerId: johnsClient._id.toString() }));
        expect(res.status).toBe(201);
        expect(idOf(res.body.data.customer)).toBe(String(johnsClient._id));
        expect(idOf(res.body.data.teamMember)).toBe(String(john.member._id));
        expect(res.body.data.walkInName).toBeNull();
        // Never booked with the staff member as the client.
        expect(await Appointment.countDocuments({ customer: john.login._id })).toBe(0);
    });

    it("lands in their OWN column even when the body names a colleague's", async () => {
        const { service, john, sarah, johnsClient } = await setup();
        const res = await book(john.login, slot({
            service: service._id.toString(), customerId: johnsClient._id.toString(), teamMember: sarah.member._id.toString(),
        }));
        expect(res.status).toBe(201);
        expect(idOf(res.body.data.teamMember)).toBe(String(john.member._id));
        expect(await Appointment.countDocuments({ teamMember: sarah.member._id, customer: johnsClient._id })).toBe(0);
    });

    it("prices the booking off their own column, not a colleague's override named in the body", async () => {
        const { service, john, sarah, johnsClient } = await setup();
        await TeamMember.updateOne({ _id: sarah.member._id }, { $set: { serviceOverrides: [{ service: service._id, price: 999 }] } });
        const res = await book(john.login, slot({
            service: service._id.toString(), customerId: johnsClient._id.toString(), teamMember: sarah.member._id.toString(),
        }));
        expect(res.status).toBe(201);
        expect(res.body.data.totalPrice).toBe(50);
    });

    it('counts a client they served as one segment of a multi-service booking', async () => {
        const { provider, service, john } = await setup();
        const segmentClient = await makeUser({ name: 'Frieda Nghipondoka' });
        await makeAppointment(segmentClient._id, service._id, provider._id, {
            status: 'completed', startTime: '12:00', endTime: '13:00',
            services: [{ service: service._id, name: 'Cut', startTime: '12:00', endTime: '12:30', teamMember: john.member._id }],
        });
        const res = await book(john.login, slot({ service: service._id.toString(), customerId: segmentClient._id.toString() }));
        expect(res.status).toBe(201);
        expect(idOf(res.body.data.teamMember)).toBe(String(john.member._id));
    });

    it("refuses a colleague's client — nothing booked", async () => {
        const { service, john, sarahsClient } = await setup();
        const before = await Appointment.countDocuments({});
        const res = await book(john.login, slot({ service: service._id.toString(), customerId: sarahsClient._id.toString() }));
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('staff_booking_not_allowed');
        expect(res.body.message).toMatch(/clients you serve/i);
        expect(await Appointment.countDocuments({})).toBe(before);
    });

    it("refuses the owner's client, even when asking for the owner's column", async () => {
        const { service, john, ownersClient } = await setup();
        const res = await book(john.login, slot({ service: service._id.toString(), customerId: ownersClient._id.toString(), teamMember: 'owner' }));
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('staff_booking_not_allowed');
    });

    it('refuses an account that never booked the business', async () => {
        const { service, john } = await setup();
        const stranger = await makeUser();
        const res = await book(john.login, slot({ service: service._id.toString(), customerId: stranger._id.toString() }));
        expect(res.status).toBe(403);
    });

    it("refuses a client they served at ANOTHER business (scope keys on their employer)", async () => {
        const { service, john } = await setup();
        const otherBiz = await makeProvider();
        const otherSvc = await makeService(otherBiz._id);
        const elsewhere = await makeUser();
        // Same member id on a booking of another business can't make them "theirs" here.
        await makeAppointment(elsewhere._id, otherSvc._id, otherBiz._id, { status: 'completed', teamMember: john.member._id });
        const res = await book(john.login, slot({ service: service._id.toString(), customerId: elsewhere._id.toString() }));
        expect(res.status).toBe(403);
    });

    it('answers a walk-in list id sent as a client id with a 400, not a server error', async () => {
        const { service, john } = await setup();
        const res = await book(john.login, slot({ service: service._id.toString(), customerId: 'walkin:jane passerby' }));
        expect(res.status).toBe(400);
        expect(await Appointment.countDocuments({ walkInName: /jane/i })).toBe(0);
    });

    it('is held to the customer past-slot guard', async () => {
        const { service, john, johnsClient } = await setup();
        const res = await book(john.login, slot({ service: service._id.toString(), customerId: johnsClient._id.toString(), appointmentDate: '2020-01-06' }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already passed/i);
    });

    it('is refused when their own column is not bookable (the app hides the "+" for them)', async () => {
        const { service, john, johnsClient } = await setup();
        await TeamMember.updateOne({ _id: john.member._id }, { $set: { bookable: false } });
        const res = await book(john.login, slot({ service: service._id.toString(), customerId: johnsClient._id.toString() }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/not available for online booking/i);
    });
});

describe('the same rules for an explicit Service provider (low)', () => {
    it('books their own client; refuses a colleague\'s', async () => {
        const { service, john, johnsClient, sarahsClient } = await setup({ johnTier: 'low' });
        const own = await book(john.login, slot({ service: service._id.toString(), customerId: johnsClient._id.toString() }));
        expect(own.status).toBe(201);
        expect(idOf(own.body.data.teamMember)).toBe(String(john.member._id));
        const other = await book(john.login, slot({ service: service._id.toString(), customerId: sarahsClient._id.toString(), startTime: '15:00', endTime: '15:30' }));
        expect(other.status).toBe(403);
    });

    it('with the owner-granted clients:view_all add-on books any client of the business — still into their own column', async () => {
        const { service, john, sarah, sarahsClient } = await setup({ johnTier: 'low', johnPermissions: ['clients:view_all'] });
        const res = await book(john.login, slot({
            service: service._id.toString(), customerId: sarahsClient._id.toString(), teamMember: sarah.member._id.toString(),
        }));
        expect(res.status).toBe(201);
        expect(idOf(res.body.data.customer)).toBe(String(sarahsClient._id));
        expect(idOf(res.body.data.teamMember)).toBe(String(john.member._id));
    });
});

describe('an explicit Basic (view-only) member books nothing', () => {
    it('refuses their own client and a walk-in alike', async () => {
        const { service, john, johnsClient } = await setup({ johnTier: 'basic' });
        const client = await book(john.login, slot({ service: service._id.toString(), customerId: johnsClient._id.toString() }));
        expect(client.status).toBe(403);
        expect(client.body.code).toBe('staff_booking_not_allowed');
        expect(client.body.message).toMatch(/doesn.t include making bookings/i);
        const walkIn = await book(john.login, slot({ service: service._id.toString(), walkInName: 'Jane Passerby' }));
        expect(walkIn.status).toBe(403);
        expect(walkIn.body.code).toBe('staff_booking_not_allowed');
    });
});

describe('Medium and High are unchanged', () => {
    it('Medium books a client they do not serve, into the colleague column they choose', async () => {
        const { provider, service, sarah, ownersClient } = await setup();
        const medium = await makeStaff(provider, 'medium');
        const res = await book(medium.login, slot({
            service: service._id.toString(), customerId: ownersClient._id.toString(), teamMember: sarah.member._id.toString(),
        }));
        expect(res.status).toBe(201);
        expect(idOf(res.body.data.teamMember)).toBe(String(sarah.member._id));
    });

    it('High books any client of the business into their own column', async () => {
        const { provider, service, sarahsClient } = await setup();
        const high = await makeStaff(provider, 'high');
        const res = await book(high.login, slot({
            service: service._id.toString(), customerId: sarahsClient._id.toString(), teamMember: high.member._id.toString(),
        }));
        expect(res.status).toBe(201);
        expect(idOf(res.body.data.teamMember)).toBe(String(high.member._id));
    });
});
