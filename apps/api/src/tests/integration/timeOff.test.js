/**
 * Staff time off — a multi-day leave range, owner-managed with staff
 * self-service requests.
 *
 * The point these pin: only APPROVED leave closes the calendar. An owner sets
 * leave and it applies at once; a staff request is pending and does nothing to
 * bookings until the owner approves it. And leave is honoured through the same
 * staffHoursReason gate every booking path already uses, so it can't be enforced
 * in one place and forgotten in another.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const TimeOff = require('../../models/TimeOff');
const User = require('../../models/User');
const { resolveBookingStaff } = require('../../utils/staffBooking');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const everyDay = (start, end) => {
    const s = {};
    DAYS.forEach((d) => { s[d] = { enabled: true, slots: [{ start, end }] }; });
    return s;
};
const DATE = '2026-09-16';        // inside a 15th–18th leave range used below
const BEFORE = '2026-09-14';      // outside it

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const svc = await makeService(provider._id);
    const member = await TeamMember.create({ provider: provider._id, name: 'Moses Hamalwa' });
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '18:00') });
    await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule: everyDay('09:00', '17:00') });
    return { provider, customer, svc, member };
};

// A staff login wired to the member, for the self-service endpoints.
const attachStaff = async (provider, member) => {
    const staffUser = await User.create({
        name: 'Moses Hamalwa', email: `moses${member._id}@test.com`, password: 'Password1!',
        phone: '+264810000009', role: 'staff', staffOf: provider._id, isVerified: true, provider: 'local',
    });
    member.user = staffUser._id;
    await member.save();
    return staffUser;
};

const tryBook = (ctx, date, startTime, endTime) => resolveBookingStaff({
    svc: ctx.svc, providerId: ctx.provider._id, appointmentDate: date, startTime, endTime,
    requestedTeamMember: ctx.member._id, requester: { role: 'customer', _id: ctx.customer._id },
});

const ownerTimeOff = (provider, member) => `/api/team/${member._id}/timeoff`;

describe('owner-managed time off', () => {
    it('creates approved leave and lists it back', async () => {
        const { provider, member } = await setup();

        const res = await request(app).post(ownerTimeOff(provider, member)).set(authHeader(provider))
            .send({ startDate: '2026-09-15', endDate: '2026-09-18', allDay: true, type: 'vacation', note: 'Up north' });

        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe('approved');

        const list = await request(app).get(ownerTimeOff(provider, member)).set(authHeader(provider));
        expect(list.body.data).toHaveLength(1);
        expect(list.body.data[0].note).toBe('Up north');
    });

    it('closes the calendar for an all-day leave, and only for those days', async () => {
        const ctx = await setup();
        await request(app).post(ownerTimeOff(ctx.provider, ctx.member)).set(authHeader(ctx.provider))
            .send({ startDate: '2026-09-15', endDate: '2026-09-18', allDay: true });

        // 16th is inside the range — on leave.
        expect((await tryBook(ctx, DATE, '10:00', '10:30')).error).toMatch(/leave/i);
        // 14th is outside it — bookable as usual.
        expect((await tryBook(ctx, BEFORE, '10:00', '10:30')).teamMember).toBeTruthy();
    });

    it('a windowed leave blocks only its hours', async () => {
        const ctx = await setup();
        await request(app).post(ownerTimeOff(ctx.provider, ctx.member)).set(authHeader(ctx.provider))
            .send({ startDate: DATE, endDate: DATE, allDay: false, startTime: '13:00', endTime: '15:00' });

        expect((await tryBook(ctx, DATE, '13:30', '14:00')).error).toMatch(/leave/i);
        expect((await tryBook(ctx, DATE, '10:00', '10:30')).teamMember).toBeTruthy();  // morning is fine
    });

    it('leave overrides the roster — even a working shift that day', async () => {
        const ctx = await setup();
        const Shift = require('../../models/Shift');
        await Shift.create({ provider: ctx.provider._id, teamMember: ctx.member._id, date: DATE, slots: [{ start: '09:00', end: '17:00' }] });
        await request(app).post(ownerTimeOff(ctx.provider, ctx.member)).set(authHeader(ctx.provider))
            .send({ startDate: DATE, endDate: DATE, allDay: true });

        expect((await tryBook(ctx, DATE, '10:00', '10:30')).error).toMatch(/leave/i);
    });

    it('removing leave reopens the day', async () => {
        const ctx = await setup();
        const create = await request(app).post(ownerTimeOff(ctx.provider, ctx.member)).set(authHeader(ctx.provider))
            .send({ startDate: DATE, endDate: DATE, allDay: true });
        expect((await tryBook(ctx, DATE, '10:00', '10:30')).error).toMatch(/leave/i);

        const del = await request(app).delete(`${ownerTimeOff(ctx.provider, ctx.member)}/${create.body.data._id}`).set(authHeader(ctx.provider));
        expect(del.status).toBe(200);
        expect((await tryBook(ctx, DATE, '10:00', '10:30')).teamMember).toBeTruthy();
    });

    it('rejects an inverted range and a timed leave with no times', async () => {
        const { provider, member } = await setup();
        const bad1 = await request(app).post(ownerTimeOff(provider, member)).set(authHeader(provider))
            .send({ startDate: '2026-09-18', endDate: '2026-09-15' });
        expect(bad1.status).toBe(400);

        const bad2 = await request(app).post(ownerTimeOff(provider, member)).set(authHeader(provider))
            .send({ startDate: DATE, endDate: DATE, allDay: false });
        expect(bad2.status).toBe(400);
    });

    it('refuses another provider\'s member', async () => {
        const { member } = await setup();
        const intruder = await makeProvider();
        const res = await request(app).post(`/api/team/${member._id}/timeoff`).set(authHeader(intruder))
            .send({ startDate: DATE, endDate: DATE, allDay: true });
        expect(res.status).toBe(404);
        expect(await TimeOff.countDocuments()).toBe(0);
    });
});

describe('staff self-service requests', () => {
    it('a staff request is pending and does not close the calendar until approved', async () => {
        const ctx = await setup();
        const staff = await attachStaff(ctx.provider, ctx.member);

        const req = await request(app).post('/api/timeoff/mine').set(authHeader(staff))
            .send({ startDate: DATE, endDate: DATE, allDay: true, type: 'sick' });
        expect(req.status).toBe(201);
        expect(req.body.data.status).toBe('pending');
        expect(req.body.data.requestedBy).toBe('staff');

        // Pending — the member is still bookable.
        expect((await tryBook(ctx, DATE, '10:00', '10:30')).teamMember).toBeTruthy();

        // The owner sees it and approves it.
        const list = await request(app).get(ownerTimeOff(ctx.provider, ctx.member)).set(authHeader(ctx.provider));
        expect(list.body.data[0].status).toBe('pending');
        const decide = await request(app)
            .patch(`${ownerTimeOff(ctx.provider, ctx.member)}/${req.body.data._id}/decision`)
            .set(authHeader(ctx.provider)).send({ status: 'approved' });
        expect(decide.status).toBe(200);

        // Now it closes the calendar.
        expect((await tryBook(ctx, DATE, '10:00', '10:30')).error).toMatch(/leave/i);
    });

    it('a declined request never closes the calendar', async () => {
        const ctx = await setup();
        const staff = await attachStaff(ctx.provider, ctx.member);
        const req = await request(app).post('/api/timeoff/mine').set(authHeader(staff))
            .send({ startDate: DATE, endDate: DATE, allDay: true });

        await request(app).patch(`${ownerTimeOff(ctx.provider, ctx.member)}/${req.body.data._id}/decision`)
            .set(authHeader(ctx.provider)).send({ status: 'declined' });

        expect((await tryBook(ctx, DATE, '10:00', '10:30')).teamMember).toBeTruthy();
    });

    it('staff can withdraw their own pending request', async () => {
        const ctx = await setup();
        const staff = await attachStaff(ctx.provider, ctx.member);
        const req = await request(app).post('/api/timeoff/mine').set(authHeader(staff))
            .send({ startDate: DATE, endDate: DATE, allDay: true });

        const del = await request(app).delete(`/api/timeoff/mine/${req.body.data._id}`).set(authHeader(staff));
        expect(del.status).toBe(200);
        expect(await TimeOff.countDocuments()).toBe(0);
    });

    it('a provider (no team-member record) cannot request via self-service', async () => {
        const { provider } = await setup();
        const res = await request(app).post('/api/timeoff/mine').set(authHeader(provider))
            .send({ startDate: DATE, endDate: DATE, allDay: true });
        expect(res.status).toBe(403);
    });
});

describe('what the customer is shown', () => {
    it('reports all-day leave as busy in booked-slots', async () => {
        const { provider, member } = await setup();
        await TimeOff.create({ provider: provider._id, teamMember: member._id, startDate: DATE, endDate: DATE, allDay: true, status: 'approved' });

        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}&teamMember=${member._id}`);

        const off = res.body.data.filter((b) => b.kind === 'time_off');
        expect(off).toHaveLength(1);
        expect(off[0]).toMatchObject({ startTime: '00:00', endTime: '23:59' });
    });

    it('marks an all-day leave date as off in the date picker feed', async () => {
        const { provider, member } = await setup();
        await TimeOff.create({ provider: provider._id, teamMember: member._id, startDate: DATE, endDate: DATE, allDay: true, status: 'approved' });

        const res = await request(app)
            .get(`/api/providers/${provider._id}/staff/${member._id}/shift-days?from=2026-09-01&to=2026-09-30`);

        expect(res.body.data.off).toContain(DATE);
    });

    // A pending request must not leak into what closes the customer's calendar.
    it('ignores a pending leave in booked-slots', async () => {
        const { provider, member } = await setup();
        await TimeOff.create({ provider: provider._id, teamMember: member._id, startDate: DATE, endDate: DATE, allDay: true, status: 'pending' });

        const res = await request(app)
            .get(`/api/appointments/booked-slots?providerId=${provider._id}&date=${DATE}&teamMember=${member._id}`);

        expect(res.body.data.some((b) => b.kind === 'time_off')).toBe(false);
    });
});
