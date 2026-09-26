/**
 * Trading hours read back the same everywhere.
 *
 * Owner's report: "When the owner is setting [the hours] it's not showing the
 * same hours on the set hours." New Appointment showed the business's hours for
 * every column (a team member's own hours ignored), and a day switched off still
 * offered 08:00–20:00. This suite pins, with the server in UTC and a Windhoek
 * business (production has no TZ set, so Node runs in UTC):
 *   - the owner's Working Hours save only what the screen shows (no day switched
 *     on without times, no closing before opening) and read back identically
 *   - GET /api/team/:id/hours returns one person's hours for a date by the same
 *     rules bookings are checked against (owner = business hours; member =
 *     leave → shift → weekly within business hours → business hours)
 *   - a Saturday is read as Saturday, and a customer booking agrees with it
 */
process.env.TZ = 'UTC';

const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Shift = require('../../models/Shift');
const TimeOff = require('../../models/TimeOff');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
// The owner's week from the report's reproduction: Mon–Fri 08:30–18:00,
// Sat 09:00–14:00, Sun closed.
const WEEK = Object.fromEntries(DAYS.map((d) => [d,
    d === 'sunday' ? { enabled: false, slots: [{ start: '09:00', end: '17:00' }] }
        : d === 'saturday' ? { enabled: true, slots: [{ start: '09:00', end: '14:00' }] }
            : { enabled: true, slots: [{ start: '08:30', end: '18:00' }] }]));

// A Saturday / Monday at least a week out, as Windhoek calendar dates.
const windhoekToday = () => new Date(Date.now() + 2 * 3600e3);
const nextDow = (dow, minDays = 7) => {
    const t = windhoekToday();
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + minDays));
    while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
};
const SAT = nextDow(6);
const MON = nextDow(1);

const setOwnerHours = (owner, schedule = WEEK) =>
    request(app).put('/api/availability/me').set(authHeader(owner)).send({ schedule });
const hours = (asUser, id, date) =>
    request(app).get(`/api/team/${id}/hours`).query({ date }).set(authHeader(asUser));

const team = async () => {
    const owner = await makeProvider();
    await setOwnerHours(owner).expect(200);
    const staffUser = await User.create({
        name: 'Erastus', email: `erastus${Date.now()}@staff.test`, password: 'Password1!', phone: '+264810000077',
        role: 'staff', staffOf: owner._id, accountType: 'business', isVerified: true, provider: 'local',
    });
    const erastus = await TeamMember.create({ provider: owner._id, name: 'Erastus', user: staffUser._id });
    const john = await TeamMember.create({ provider: owner._id, name: 'John' });
    // Erastus: Mon, Tue, Thu, Fri 08:00–17:00 — never Saturdays.
    await StaffAvailability.create({
        provider: owner._id, teamMember: erastus._id,
        schedule: Object.fromEntries(DAYS.map((d) => [d, ['monday', 'tuesday', 'thursday', 'friday'].includes(d)
            ? { enabled: true, slots: [{ start: '08:00', end: '17:00' }] } : { enabled: false, slots: [] }])),
    });
    return { owner, staffUser, erastus, john };
};

describe('server clock', () => {
    it('runs this suite in UTC, like production', () => {
        expect(new Date('2026-09-26T00:00:00Z').getTimezoneOffset()).toBe(0);
    });
});

describe('the owner\'s Working Hours save what the screen shows', () => {
    it('reads back exactly what was saved, day by day', async () => {
        const owner = await makeProvider();
        await setOwnerHours(owner).expect(200);
        const res = await request(app).get('/api/availability/me').set(authHeader(owner)).expect(200);
        const sched = res.body.data.schedule;
        DAYS.forEach((d) => {
            expect(sched[d].enabled).toBe(WEEK[d].enabled);
            expect(sched[d].slots.map(({ start, end }) => ({ start, end }))).toEqual(WEEK[d].slots);
        });
        // The public profile reads the same document.
        const pub = await request(app).get(`/api/availability/${owner._id}`).expect(200);
        expect(pub.body.data.schedule.saturday.slots[0]).toMatchObject({ start: '09:00', end: '14:00' });
    });

    it('keeps a split day (two periods)', async () => {
        const owner = await makeProvider();
        const split = { ...WEEK, friday: { enabled: true, slots: [{ start: '08:30', end: '12:00' }, { start: '14:00', end: '18:00' }] } };
        const res = await setOwnerHours(owner, split).expect(200);
        expect(res.body.data.schedule.friday.slots.map((s) => `${s.start}-${s.end}`)).toEqual(['08:30-12:00', '14:00-18:00']);
    });

    it.each([
        ['a day switched on with no times', { saturday: { enabled: true, slots: [] } }, /Saturday: set the opening and closing time/],
        ['closing before opening', { saturday: { enabled: true, slots: [{ start: '14:00', end: '09:00' }] } }, /Saturday: the closing time \(09:00\) must be after the opening time \(14:00\)/],
        ['a period with no closing time', { monday: { enabled: true, slots: [{ start: '08:30' }] } }, /Monday: times must be HH:mm/],
        ['a 12-hour time', { monday: { enabled: true, slots: [{ start: '8:30 AM', end: '6:00 PM' }] } }, /Monday: times must be HH:mm/],
        ['overlapping periods', { friday: { enabled: true, slots: [{ start: '08:00', end: '13:00' }, { start: '12:00', end: '18:00' }] } }, /Friday: two opening periods overlap/],
        ['an unknown day', { funday: { enabled: true, slots: [{ start: '08:00', end: '13:00' }] } }, /Unknown day/],
    ])('refuses %s, naming the day', async (_label, patch, message) => {
        const owner = await makeProvider();
        const res = await setOwnerHours(owner, { ...WEEK, ...patch }).expect(400);
        expect(res.body.message).toMatch(message);
    });

    it('accepts 00:xx and minutes other than :00', async () => {
        const owner = await makeProvider();
        const late = { ...WEEK, friday: { enabled: true, slots: [{ start: '00:15', end: '23:45' }] } };
        const res = await setOwnerHours(owner, late).expect(200);
        expect(res.body.data.schedule.friday.slots[0]).toMatchObject({ start: '00:15', end: '23:45' });
    });
});

describe('GET /api/team/:id/hours — one person\'s hours on a date', () => {
    it('the owner\'s own column is the business\'s Working Hours (Saturday read as Saturday)', async () => {
        const { owner } = await team();
        const res = await hours(owner, 'owner', SAT).expect(200);
        expect(res.body.data).toMatchObject({ day: 'saturday', source: 'business', slots: [{ start: '09:00', end: '14:00' }] });
        const sun = await hours(owner, 'owner', nextDow(0)).expect(200);
        expect(sun.body.data).toMatchObject({ day: 'sunday', slots: [] });
    });

    it('a member who doesn\'t work Saturdays has no hours on Saturday', async () => {
        const { owner, erastus } = await team();
        const res = await hours(owner, erastus._id, SAT).expect(200);
        expect(res.body.data).toMatchObject({ source: 'weekly', slots: [] });
    });

    it('a member\'s weekly hours are capped by the business\'s (what bookings accept)', async () => {
        const { owner, erastus } = await team();
        const res = await hours(owner, erastus._id, MON).expect(200);
        expect(res.body.data.own).toEqual([{ start: '08:00', end: '17:00' }]);
        expect(res.body.data.slots).toEqual([{ start: '08:30', end: '17:00' }]);
    });

    it('a member with no hours of their own works the business\'s', async () => {
        const { owner, john } = await team();
        const res = await hours(owner, john._id, SAT).expect(200);
        expect(res.body.data).toMatchObject({ source: 'business', slots: [{ start: '09:00', end: '14:00' }] });
    });

    it('a shift replaces the weekly hours for its date, and its break is busy', async () => {
        const { owner, erastus } = await team();
        await Shift.create({ provider: owner._id, teamMember: erastus._id, date: SAT, slots: [{ start: '10:00', end: '16:00' }], breaks: [{ start: '12:00', end: '12:30' }] });
        const res = await hours(owner, erastus._id, SAT).expect(200);
        expect(res.body.data).toMatchObject({ source: 'shift', slots: [{ start: '10:00', end: '16:00' }] });
        expect(res.body.data.busy).toEqual([{ startTime: '12:00', endTime: '12:30', kind: 'break' }]);
    });

    it('approved all-day leave closes the day', async () => {
        const { owner, erastus } = await team();
        await TimeOff.create({ provider: owner._id, teamMember: erastus._id, startDate: MON, endDate: MON, allDay: true, status: 'approved', type: 'vacation' });
        const res = await hours(owner, erastus._id, MON).expect(200);
        expect(res.body.data).toMatchObject({ source: 'leave', slots: [] });
    });

    it('a member reads their own hours as "mine"', async () => {
        const { staffUser } = await team();
        const res = await hours(staffUser, 'mine', MON).expect(200);
        expect(res.body.data.slots).toEqual([{ start: '08:30', end: '17:00' }]);
    });

    it('never reads another business\'s member, and checks the date', async () => {
        const { erastus } = await team();
        const stranger = await makeProvider();
        await hours(stranger, erastus._id, MON).expect(404);
        const customer = await makeUser();
        await hours(customer, erastus._id, MON).expect(404);
        const { owner } = await team();
        await hours(owner, 'owner', '26/09/2026').expect(400);
        await hours(owner, 'not-an-id', MON).expect(400);
    });
});

describe('a client booking agrees with the saved hours', () => {
    it('Saturday 09:00–14:00: 13:00 for 45 min is accepted, 13:30 (ends 14:15) is refused', async () => {
        const owner = await makeProvider();
        await setOwnerHours(owner).expect(200);
        const svc = await makeService(owner._id, { duration: 45 });
        const customer = await makeUser();
        const book = (startTime, endTime) => request(app).post('/api/appointments').set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: SAT, startTime, endTime });
        await book('13:30', '14:15').expect(400);
        const ok = await book('13:00', '13:45');
        expect(ok.status).toBe(201);
        // Sunday is closed for clients too.
        const sun = await request(app).post('/api/appointments').set(authHeader(customer))
            .send({ service: svc._id.toString(), appointmentDate: nextDow(0), startTime: '10:00', endTime: '10:45' });
        expect(sun.status).toBe(400);
    });
});
