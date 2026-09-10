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

    it('shows the whole business with calendar:all', async () => {
        const { mosesLogin, mine, hers } = await setup(['calendar:all']);

        const res = await listFor(mosesLogin);

        expect(res.status).toBe(200);
        const ids = res.body.data.map((a) => a._id).sort();
        expect(ids).toEqual([mine._id.toString(), hers._id.toString()].sort());
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

describe('setting permissions', () => {
    it('lets the owner grant calendar:all', async () => {
        const { provider, moses, mosesLogin } = await setup(['calendar:self']);

        const res = await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(provider))
            .send({ permissions: ['calendar:all'] });

        expect(res.status).toBe(200);
        expect((await User.findById(mosesLogin._id)).staffPermissions).toEqual(['calendar:all']);
    });

    // The whole point of it being a permission and not a preference.
    it('does not let a staff member grant it to themselves', async () => {
        const { moses, mosesLogin } = await setup(['calendar:self']);

        const res = await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(mosesLogin))
            .send({ permissions: ['calendar:all'] });

        expect(res.status).toBe(403);
        expect((await User.findById(mosesLogin._id)).staffPermissions).toEqual(['calendar:self']);
    });

    it('refuses another provider\'s team member', async () => {
        const { moses, mosesLogin } = await setup(['calendar:self']);
        const intruder = await makeProvider();

        const res = await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(intruder))
            .send({ permissions: ['calendar:all'] });

        expect(res.status).toBe(404);
        expect((await User.findById(mosesLogin._id)).staffPermissions).toEqual(['calendar:self']);
    });

    // A typo must not sit in the database looking like a granted permission.
    it('rejects an unknown flag instead of storing it', async () => {
        const { provider, moses, mosesLogin } = await setup(['calendar:self']);

        const res = await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(provider))
            .send({ permissions: ['calendar:all', 'earnings:everything'] });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/unknown permission/i);
        expect((await User.findById(mosesLogin._id)).staffPermissions).toEqual(['calendar:self']);
    });

    it('refuses a member who has no login yet', async () => {
        const { provider, sarah } = await setup([]);   // sarah was never invited

        const res = await request(app)
            .put(`/api/team/${sarah._id}/permissions`)
            .set(authHeader(provider))
            .send({ permissions: ['calendar:all'] });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/invite them first/i);
    });

    it('revoking calendar:all narrows the view again', async () => {
        const { provider, moses, mosesLogin, mine } = await setup(['calendar:all']);

        await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(provider))
            .send({ permissions: ['calendar:self'] });

        const refreshed = await User.findById(mosesLogin._id);
        const res = await listFor(refreshed);

        expect(res.body.data.map((a) => a._id)).toEqual([mine._id.toString()]);
    });
});

describe('permission tiers', () => {
    it('assigning the Medium tier grants whole-business calendar view', async () => {
        const { provider, moses, mosesLogin, mine, hers } = await setup([]); // no legacy flags

        const set = await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(provider))
            .send({ tier: 'medium' });
        expect(set.status).toBe(200);
        expect(set.body.data.tier).toBe('medium');
        expect((await User.findById(mosesLogin._id)).staffTier).toBe('medium');

        const refreshed = await User.findById(mosesLogin._id);
        const res = await listFor(refreshed);
        const ids = res.body.data.map((a) => a._id).sort();
        expect(ids).toEqual([mine._id.toString(), hers._id.toString()].sort());
    });

    it('a Basic tier keeps the member scoped to their own bookings', async () => {
        const { provider, moses, mosesLogin, mine } = await setup([]);
        await request(app).put(`/api/team/${moses._id}/permissions`).set(authHeader(provider)).send({ tier: 'basic' });

        const res = await listFor(await User.findById(mosesLogin._id));
        expect(res.body.data.map((a) => a._id)).toEqual([mine._id.toString()]);
    });

    it('rejects an unknown tier instead of storing it', async () => {
        const { provider, moses, mosesLogin } = await setup([]);
        const res = await request(app)
            .put(`/api/team/${moses._id}/permissions`)
            .set(authHeader(provider))
            .send({ tier: 'superuser' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/unknown tier/i);
        expect((await User.findById(mosesLogin._id)).staffTier).toBeNull();
    });

    it('setting tier:null resets to the self-baseline', async () => {
        const { provider, moses, mosesLogin } = await setup([]);
        await request(app).put(`/api/team/${moses._id}/permissions`).set(authHeader(provider)).send({ tier: 'high' });
        const reset = await request(app).put(`/api/team/${moses._id}/permissions`).set(authHeader(provider)).send({ tier: null });
        expect(reset.status).toBe(200);
        expect((await User.findById(mosesLogin._id)).staffTier).toBeNull();
    });

    it('the invite path now rejects an unknown permission instead of storing it raw', async () => {
        const provider = await makeProvider();
        const member = await TeamMember.create({ provider: provider._id, name: 'New Hire', email: 'newhire2@test.com' });
        const res = await request(app)
            .post(`/api/team/${member._id}/invite`)
            .set(authHeader(provider))
            .send({ permissions: ['calendar:all', 'take:over:everything'] });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/unknown permission/i);
        // No staff account was created with the junk.
        expect(await User.findOne({ email: 'newhire2@test.com' })).toBeNull();
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

    it('a Medium member can change ANY booking in the business', async () => {
        const { mosesLogin, hers } = await setup([]);
        await setTier(mosesLogin._id, 'medium');
        const res = await setStatus(mosesLogin, hers._id, 'confirmed');
        expect(res.status).toBe(200);
    });

    it('a Basic member is refused at the route — no booking capability', async () => {
        const { mosesLogin, mine } = await setup([]); // tier null → Basic
        const res = await setStatus(mosesLogin, mine._id, 'confirmed');
        expect(res.status).toBe(403);
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

    it('a Medium member can reschedule ANY booking in the business', async () => {
        const { mosesLogin, hers } = await setup([]);
        await setTier(mosesLogin._id, 'medium');
        const res = await reschedule(mosesLogin, hers._id, weekday());
        expect(res.status).toBe(200);
    });

    it('a Basic member is refused at the route — no reschedule capability', async () => {
        const { mosesLogin, mine } = await setup([]); // tier null → Basic
        const res = await reschedule(mosesLogin, mine._id, weekday());
        expect(res.status).toBe(403);
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

    it('a Basic member cannot log a walk-in — the name is ignored and they are booked as themselves', async () => {
        const { mosesLogin, service } = await setup([]); // tier null → Basic, no bookings:create
        const res = await book(mosesLogin, walkIn({ service: service._id.toString() }));
        expect(res.status).toBe(201);
        expect(res.body.data.walkInName).toBeNull();
        expect(String(res.body.data.customer?._id || res.body.data.customer)).toBe(String(mosesLogin._id));
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
        // Not their business → not a walk-in; they book it customer-like (no walkInName).
        const res = await book(mosesLogin, walkIn({ service: otherService._id.toString() }));
        expect(res.status).toBe(201);
        expect(res.body.data.walkInName).toBeNull();
        expect(String(res.body.data.customer?._id || res.body.data.customer)).toBe(String(mosesLogin._id));
    });
});
