/**
 * A team member's Working Hours — the same screen the owner has, over their own
 * week. The owner's decisions this pins:
 *   - a member changes their own weekly hours and it applies AT ONCE (no
 *     approval): a day they switch off can't be booked, a day they switch on can;
 *   - they can only ever touch their OWN hours, never a colleague's;
 *   - the owner can set any member's hours from Team — but not another
 *     business's member;
 *   - the owner gets an in-app notification naming what the member changed
 *     (never an email), and nothing when the owner changes it themself or a
 *     member saves the same week again.
 */
const request = require('supertest');
const { futureDate } = require('../helpers/dates');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Notification = require('../../models/Notification');
const User = require('../../models/User');
const { resolveBookingStaff } = require('../../utils/staffBooking');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_OF = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const week = (start = '09:00', end = '17:00') => Object.fromEntries(DAYS.map((d) => [d, { enabled: true, slots: [{ start, end }] }]));
const DATE = futureDate(3);
const dayOf = (key) => DAY_OF[new Date(`${key}T00:00:00.000Z`).getUTCDay()];
const cap = (d) => d.charAt(0).toUpperCase() + d.slice(1);

let seq = 0;
const staffFor = async (provider, member, name = 'Moses Hamalwa') => {
    seq += 1;
    const u = await User.create({
        name, email: `staff${seq}${member._id}@test.com`, password: 'Password1!',
        phone: `+2648100${String(seq).padStart(5, '0')}`, role: 'staff', staffOf: provider._id, isVerified: true, provider: 'local',
    });
    member.user = u._id;
    await member.save();
    return u;
};

const setup = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const svc = await makeService(provider._id);
    const member = await TeamMember.create({ provider: provider._id, name: 'Moses Hamalwa' });
    await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule: week() });
    const staff = await staffFor(provider, member);
    return { provider, customer, svc, member, staff };
};

const tryBook = (ctx, date, startTime, endTime) => resolveBookingStaff({
    svc: ctx.svc, providerId: ctx.provider._id, appointmentDate: date, startTime, endTime,
    requestedTeamMember: ctx.member._id, requester: { role: 'customer', _id: ctx.customer._id },
});

describe('a member sets their own working hours', () => {
    it('applies at once: a day switched off is refused, new hours are bookable', async () => {
        const ctx = await setup();
        expect((await tryBook(ctx, DATE, '10:00', '10:30')).teamMember).toBeTruthy();

        const next = week();
        next[dayOf(DATE)] = { enabled: false, slots: [{ start: '09:00', end: '17:00' }] };
        const res = await request(app).put('/api/team/mine/availability').set(authHeader(ctx.staff)).send({ schedule: next });
        expect(res.status).toBe(200);
        expect((await tryBook(ctx, DATE, '10:00', '10:30')).error).toBeTruthy();

        next[dayOf(DATE)] = { enabled: true, slots: [{ start: '18:00', end: '21:00' }] };
        await request(app).put('/api/team/mine/availability').set(authHeader(ctx.staff)).send({ schedule: next }).expect(200);
        expect((await tryBook(ctx, DATE, '19:00', '19:30')).teamMember).toBeTruthy();
        expect((await tryBook(ctx, DATE, '10:00', '10:30')).error).toBeTruthy();
    });

    it('tells the owner in-app what changed, naming only the changed days', async () => {
        const ctx = await setup();
        const next = week();
        next.wednesday = { enabled: true, slots: [{ start: '10:00', end: '14:00' }] };
        next.sunday = { enabled: false, slots: [] };
        await request(app).put('/api/team/mine/availability').set(authHeader(ctx.staff)).send({ schedule: next }).expect(200);

        const notes = await Notification.find({ user: ctx.provider._id }).lean();
        expect(notes).toHaveLength(1);
        expect(notes[0].message).toBe('Moses changed their working hours: Wednesday 10:00 – 14:00, Sunday off.');
        expect(notes[0].link).toBe('/team');
        // Nothing for the member themself.
        expect(await Notification.countDocuments({ user: ctx.staff._id })).toBe(0);
    });

    it('a split day reads as both periods', async () => {
        const ctx = await setup();
        const next = week();
        next.monday = { enabled: true, slots: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }] };
        await request(app).put('/api/team/mine/availability').set(authHeader(ctx.staff)).send({ schedule: next }).expect(200);
        const [n] = await Notification.find({ user: ctx.provider._id }).lean();
        expect(n.message).toBe('Moses changed their working hours: Monday 09:00 – 12:00, 13:00 – 17:00.');
    });

    it('saving the same week again sends nothing', async () => {
        const ctx = await setup();
        await request(app).put('/api/team/mine/availability').set(authHeader(ctx.staff)).send({ schedule: week() }).expect(200);
        expect(await Notification.countDocuments({ user: ctx.provider._id })).toBe(0);
    });

    it('a member saving through their own member id also notifies the owner', async () => {
        const ctx = await setup();
        const next = week();
        next[dayOf(DATE)] = { enabled: false, slots: [] };
        await request(app).put(`/api/team/${ctx.member._id}/availability`).set(authHeader(ctx.staff)).send({ schedule: next }).expect(200);
        const [n] = await Notification.find({ user: ctx.provider._id }).lean();
        expect(n.message).toBe(`Moses changed their working hours: ${cap(dayOf(DATE))} off.`);
    });

    it('cannot read or change a colleague\'s hours', async () => {
        const ctx = await setup();
        const other = await TeamMember.create({ provider: ctx.provider._id, name: 'Anna Shikongo' });
        await StaffAvailability.create({ provider: ctx.provider._id, teamMember: other._id, schedule: week() });

        const get = await request(app).get(`/api/team/${other._id}/availability`).set(authHeader(ctx.staff));
        expect(get.status).toBe(404);
        const put = await request(app).put(`/api/team/${other._id}/availability`).set(authHeader(ctx.staff))
            .send({ schedule: { ...week(), monday: { enabled: false, slots: [] } } });
        expect(put.status).toBe(404);
        const still = await StaffAvailability.findOne({ teamMember: other._id }).lean();
        expect(still.schedule.monday.enabled).toBe(true);
        expect(await Notification.countDocuments()).toBe(0);
    });
});

describe('the owner sets a member\'s working hours from Team', () => {
    it('changes any member of their business, effective at once, with no notification to themself', async () => {
        const ctx = await setup();
        const next = week();
        next[dayOf(DATE)] = { enabled: false, slots: [] };
        await request(app).put(`/api/team/${ctx.member._id}/availability`).set(authHeader(ctx.provider)).send({ schedule: next }).expect(200);
        expect((await tryBook(ctx, DATE, '10:00', '10:30')).error).toBeTruthy();
        expect(await Notification.countDocuments()).toBe(0);
    });

    it('cannot touch another business\'s member', async () => {
        const ctx = await setup();
        const intruder = await makeProvider();
        const res = await request(app).put(`/api/team/${ctx.member._id}/availability`).set(authHeader(intruder))
            .send({ schedule: { ...week(), monday: { enabled: false, slots: [] } } });
        expect(res.status).toBe(404);
        const still = await StaffAvailability.findOne({ teamMember: ctx.member._id }).lean();
        expect(still.schedule.monday.enabled).toBe(true);
    });
});
