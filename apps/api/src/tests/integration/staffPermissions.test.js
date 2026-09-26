/**
 * Staff permission flags, and the calendar-access setting built on them.
 *
 * `User.staffPermissions` existed since the invite flow shipped but nothing ever
 * read it — a staff member was pinned to their own column whatever the owner
 * granted, so a calendar-access setting had nothing to act on. These pin the
 * flag actually changing what the API returns, and pin the boundary that makes
 * it a permission rather than a preference: the holder can't grant it to
 * themselves.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');
const TeamMember = require('../../models/TeamMember');
const User = require('../../models/User');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

/**
 * A business with two staff, each holding one booking, plus a login for the
 * first. Returns everything a test needs to ask "what can Moses see?".
 */
const setup = async (permissions = []) => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const service = await makeService(provider._id);

    const moses = await TeamMember.create({ provider: provider._id, name: 'Moses Hamalwa', role: 'Barber' });
    const sarah = await TeamMember.create({ provider: provider._id, name: 'Sarah Nangolo', role: 'Stylist' });

    const mosesLogin = await makeUser({
        role: 'staff', staffOf: provider._id, email: 'moses@test.com', staffPermissions: permissions,
    });
    await TeamMember.updateOne({ _id: moses._id }, { $set: { user: mosesLogin._id } });

    const mine = await makeAppointment(customer._id, service._id, provider._id, { teamMember: moses._id, startTime: '10:00', endTime: '10:30' });
    const hers = await makeAppointment(customer._id, service._id, provider._id, { teamMember: sarah._id, startTime: '11:00', endTime: '11:30' });

    return { provider, moses, sarah, mosesLogin, mine, hers, service };
};

const listFor = (user) => request(app).get('/api/appointments?all=true').set(authHeader(user));

describe('calendar access — what a staff member sees', () => {
    it('narrows to their own bookings without calendar:all', async () => {
        const { mosesLogin, mine } = await setup(['calendar:self']);

        const res = await listFor(mosesLogin);

        expect(res.status).toBe(200);
        expect(res.body.data.map((a) => a._id)).toEqual([mine._id.toString()]);
    });

    it('still narrows to their own bookings with a legacy calendar:all grant (access levels are gone)', async () => {
        const { mosesLogin, mine } = await setup(['calendar:all']);

        const res = await listFor(mosesLogin);

        expect(res.status).toBe(200);
        expect(res.body.data.map((a) => a._id)).toEqual([mine._id.toString()]);
    });

    it('never reaches another business, even holding calendar:all', async () => {
        const { mosesLogin } = await setup(['calendar:all']);
        // A completely separate business with its own booking.
        const other = await makeProvider();
        const otherCustomer = await makeUser();
        const otherService = await makeService(other._id);
        const otherAppt = await makeAppointment(otherCustomer._id, otherService._id, other._id);

        const res = await listFor(mosesLogin);

        expect(res.body.data.map((a) => a._id)).not.toContain(otherAppt._id.toString());
    });

    it('sees nothing once their roster link is severed', async () => {
        const { mosesLogin } = await setup(['calendar:all']);
        await User.updateOne({ _id: mosesLogin._id }, { $set: { staffOf: null } });
        const detached = await User.findById(mosesLogin._id);

        const res = await listFor(detached);

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
    });

    it('leaves the owner seeing everything regardless of flags', async () => {
        const { provider, mine, hers } = await setup([]);

        const res = await listFor(provider);

        const ids = res.body.data.map((a) => a._id).sort();
        expect(ids).toEqual([mine._id.toString(), hers._id.toString()].sort());
    });
});

describe('tiered booking-status actions (Phase 1)', () => {
    const setTier = (userId, t) => User.updateOne({ _id: userId }, { $set: { staffTier: t } });
    const setStatus = (user, apptId, status) =>
        request(app).put(`/api/appointments/${apptId}/status`).set(authHeader(user)).send({ status });

    it('a Low member can change the status of their OWN booking', async () => {
        const { mosesLogin, mine } = await setup([]);
        await setTier(mosesLogin._id, 'low');
        const res = await setStatus(mosesLogin, mine._id, 'confirmed');
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('confirmed');
    });

    it("a Low member CANNOT change a colleague's booking", async () => {
        const { mosesLogin, hers } = await setup([]);
        await setTier(mosesLogin._id, 'low');
        const res = await setStatus(mosesLogin, hers._id, 'confirmed');
        expect(res.status).toBe(403);
    });

    // Was `tier null → Basic`; null now means the Service-provider default, so
    // view-only is pinned with an EXPLICIT 'basic'.
    it('a member nobody chose a level for (tier null) runs their own book like a Service provider', async () => {
        const { mosesLogin, mine, hers } = await setup([]); // tier null → Service provider
        const own = await setStatus(mosesLogin, mine._id, 'confirmed');
        expect(own.status).toBe(200);
        // …but only their own: a colleague's booking stays out of reach.
        const colleague = await setStatus(mosesLogin, hers._id, 'confirmed');
        expect(colleague.status).toBe(403);
    });

    it("never reaches another business's booking, even at Medium", async () => {
        const { mosesLogin } = await setup([]);
        await setTier(mosesLogin._id, 'medium');
        const other = await makeProvider();
        const otherCustomer = await makeUser();
        const otherService = await makeService(other._id);
        const otherAppt = await makeAppointment(otherCustomer._id, otherService._id, other._id);
        const res = await setStatus(mosesLogin, otherAppt._id, 'confirmed');
        expect(res.status).toBe(403);
    });
});

describe('tiered reschedule actions (Phase 1b)', () => {
    const setTier = (userId, t) => User.updateOne({ _id: userId }, { $set: { staffTier: t } });
    // A weekday at least 3 days out — inside the default availability schedule
    // (weekends off) so the reschedule target passes the schedule check.
    const weekday = () => {
        const d = new Date();
        d.setDate(d.getDate() + 2);
        do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const reschedule = (user, apptId, date) =>
        request(app).put(`/api/appointments/${apptId}/provider-reschedule`).set(authHeader(user))
            .send({ appointmentDate: date, startTime: '14:00' });

    it('a Low member can reschedule their OWN booking', async () => {
        const { mosesLogin, mine } = await setup([]);
        await setTier(mosesLogin._id, 'low');
        const res = await reschedule(mosesLogin, mine._id, weekday());
        expect(res.status).toBe(200);
        expect(res.body.data.startTime).toBe('14:00');
    });

    it("a Low member CANNOT reschedule a colleague's booking", async () => {
        const { mosesLogin, hers } = await setup([]);
        await setTier(mosesLogin._id, 'low');
        const res = await reschedule(mosesLogin, hers._id, weekday());
        expect(res.status).toBe(403);
    });

    it('a member with no level chosen (tier null) can reschedule their OWN booking', async () => {
        const { mosesLogin, mine } = await setup([]); // tier null → Service provider
        const res = await reschedule(mosesLogin, mine._id, weekday());
        expect(res.status).toBe(200);
    });

    it("never reaches another business's booking, even at Medium", async () => {
        const { mosesLogin } = await setup([]);
        await setTier(mosesLogin._id, 'medium');
        const other = await makeProvider();
        const otherCustomer = await makeUser();
        const otherService = await makeService(other._id);
        const otherAppt = await makeAppointment(otherCustomer._id, otherService._id, other._id, {
            startTime: '10:00', endTime: '10:30',
        });
        const res = await reschedule(mosesLogin, otherAppt._id, weekday());
        expect(res.status).toBe(403);
    });
});

describe('staff walk-in create (Phase 1c)', () => {
    const setTier = (userId, t) => User.updateOne({ _id: userId }, { $set: { staffTier: t } });
    const weekday = () => {
        const d = new Date();
        d.setDate(d.getDate() + 2);
        do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const book = (user, body) => request(app).post('/api/appointments').set(authHeader(user)).send(body);
    const walkIn = (extra = {}) => ({ appointmentDate: weekday(), startTime: '14:00', endTime: '14:30', walkInName: 'Jane Passerby', ...extra });

    it('a Low member can log a walk-in in their own column', async () => {
        const { moses, mosesLogin, service } = await setup([]);
        await setTier(mosesLogin._id, 'low');
        const res = await book(mosesLogin, walkIn({ service: service._id.toString() }));
        expect(res.status).toBe(201);
        expect(res.body.data.walkInName).toBe('Jane Passerby');
        expect(res.body.data.customer).toBeNull();
        expect(String(res.body.data.teamMember)).toBe(String(moses._id));
    });

    it("forces the walk-in into the logging member's own column, ignoring a colleague id", async () => {
        const { moses, sarah, mosesLogin, service } = await setup([]);
        await setTier(mosesLogin._id, 'low');
        const res = await book(mosesLogin, walkIn({ service: service._id.toString(), teamMember: sarah._id.toString() }));
        expect(res.status).toBe(201);
        // Forced onto Moses, never Sarah — a walk-in is a self-scoped action.
        expect(String(res.body.data.teamMember)).toBe(String(moses._id));
        expect(String(res.body.data.teamMember)).not.toBe(String(sarah._id));
    });

    it("prices/times a walk-in off the logger's own column, not a colleague id in the body", async () => {
        const { moses, sarah, mosesLogin, service } = await setup([]);
        await setTier(mosesLogin._id, 'low');
        // Sarah has an inflated per-member price; Moses has none (inherits N$50).
        await TeamMember.updateOne(
            { _id: sarah._id },
            { $set: { serviceOverrides: [{ service: service._id, price: 999 }] } },
        );
        const res = await book(mosesLogin, walkIn({ service: service._id.toString(), teamMember: sarah._id.toString() }));
        expect(res.status).toBe(201);
        expect(String(res.body.data.teamMember)).toBe(String(moses._id));
        // Priced off Moses's own column (service default), never Sarah's override.
        expect(res.body.data.totalPrice).toBe(50);
    });

    it('a member with no level chosen (tier null) can log a walk-in in their own column', async () => {
        const { moses, sarah, mosesLogin, service } = await setup([]); // tier null → Service provider
        const res = await book(mosesLogin, walkIn({ service: service._id.toString(), teamMember: sarah._id.toString() }));
        expect(res.status).toBe(201);
        expect(res.body.data.walkInName).toBe('Jane Passerby');
        expect(String(res.body.data.teamMember)).toBe(String(moses._id));
    });

    it('is held to the customer past-slot guard — no back-dating a walk-in', async () => {
        const { mosesLogin, service } = await setup([]);
        await setTier(mosesLogin._id, 'low');
        const res = await book(mosesLogin, walkIn({ service: service._id.toString(), appointmentDate: '2020-01-06' }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already passed/i);
    });

    it("a staff member cannot log a walk-in against another business's service", async () => {
        const { mosesLogin } = await setup([]);
        await setTier(mosesLogin._id, 'low');
        const other = await makeProvider();
        const otherService = await makeService(other._id);
        // Not their business → not a walk-in, and a staff account is never booked as a client.
        const res = await book(mosesLogin, walkIn({ service: otherService._id.toString() }));
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('staff_booking_not_allowed');
        expect(await Appointment.countDocuments({ customer: mosesLogin._id })).toBe(0);
    });
});
