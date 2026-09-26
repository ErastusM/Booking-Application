/**
 * Split days: two working periods in one day (08:00–12:00 and 14:00–18:00).
 *
 * The owner's answer: "Yes." The Working Hours screen (the business's hours,
 * and a team member's own — the same screen) lets you add a second period.
 * The data always held a list of periods per day; this pins that both kinds of
 * hours save exactly what the screen shows (in time order), that overlapping,
 * inverted or half-set periods are refused naming the day, and that bookings
 * and every time list respect the gap between the periods.
 */
process.env.TZ = 'UTC';

const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { futureDate } = require('../helpers/dates');
const { makeProvider, makeUser, makeService, authHeader, everyDayHours } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DATE = futureDate(0); // a Wednesday
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
// A split day as the screen sends it after "+ Add a break / second period" —
// deliberately out of order, to prove it is saved in time order.
const splitWeek = () => Object.fromEntries(DAYS.map((d) => [d, {
    enabled: true, slots: [{ start: '14:00', end: '18:00' }, { start: '08:00', end: '12:00' }],
}]));
const periods = (day) => day.slots.map((s) => `${s.start}-${s.end}`);

const team = async () => {
    const owner = await makeProvider();
    const member = await TeamMember.create({ provider: owner._id, name: 'Erastus' });
    const login = await makeUser({ role: 'staff', staffOf: owner._id, email: 'erastus@test.com' });
    await TeamMember.updateOne({ _id: member._id }, { $set: { user: login._id } });
    return { owner, member, login };
};

describe('saving a split day', () => {
    it('the business\'s Working Hours: saved in time order and read back the same (and on the public profile)', async () => {
        const owner = await makeProvider();
        const res = await request(app).put('/api/availability/me').set(authHeader(owner)).send({ schedule: splitWeek() }).expect(200);
        expect(periods(res.body.data.schedule.wednesday)).toEqual(['08:00-12:00', '14:00-18:00']);
        const mine = await request(app).get('/api/availability/me').set(authHeader(owner)).expect(200);
        expect(periods(mine.body.data.schedule.monday)).toEqual(['08:00-12:00', '14:00-18:00']);
        const pub = await request(app).get(`/api/availability/${owner._id}`).expect(200);
        expect(periods(pub.body.data.schedule.friday)).toEqual(['08:00-12:00', '14:00-18:00']);
    });

    it('a member\'s own hours (from their Availability screen, and from their Team card)', async () => {
        const { owner, member, login } = await team();
        await request(app).put('/api/team/mine/availability').set(authHeader(login)).send({ schedule: splitWeek() }).expect(200);
        let doc = await StaffAvailability.findOne({ teamMember: member._id }).lean();
        expect(periods(doc.schedule.tuesday)).toEqual(['08:00-12:00', '14:00-18:00']);

        const rotation = { anchor: DATE, weeks: [splitWeek(), splitWeek()] };
        await request(app).put(`/api/team/${member._id}/availability`).set(authHeader(owner)).send({ schedule: splitWeek(), rotation }).expect(200);
        doc = await StaffAvailability.findOne({ teamMember: member._id }).lean();
        expect(periods(doc.rotation.weeks[1].thursday)).toEqual(['08:00-12:00', '14:00-18:00']);
    });

    it.each([
        ['overlapping periods', [{ start: '08:00', end: '13:00' }, { start: '12:00', end: '18:00' }], /Wednesday: two (opening|working) periods overlap/],
        ['a second period that ends before it starts', [{ start: '08:00', end: '12:00' }, { start: '15:00', end: '14:00' }], /Wednesday: the (closing|ending) time \(14:00\) must be after the (opening|starting) time \(15:00\)/],
        ['a second period with no end', [{ start: '08:00', end: '12:00' }, { start: '14:00' }], /Wednesday: times must be HH:mm/],
        ['a day switched on with no periods', [], /Wednesday: set the (opening|starting) and (closing|ending) time, or switch the day off/],
    ])('refuses %s — for the business and for a member — naming the day', async (_label, slots, message) => {
        const { owner, member, login } = await team();
        const week = { ...splitWeek(), wednesday: { enabled: true, slots } };
        const biz = await request(app).put('/api/availability/me').set(authHeader(owner)).send({ schedule: week }).expect(400);
        expect(biz.body.message).toMatch(message);
        const own = await request(app).put('/api/team/mine/availability').set(authHeader(login)).send({ schedule: week }).expect(400);
        expect(own.body.message).toMatch(message);
        const card = await request(app).put(`/api/team/${member._id}/availability`).set(authHeader(owner)).send({ schedule: week }).expect(400);
        expect(card.body.message).toMatch(message);
        const rot = await request(app).put(`/api/team/${member._id}/availability`).set(authHeader(owner))
            .send({ schedule: splitWeek(), rotation: { anchor: DATE, weeks: [splitWeek(), week] } }).expect(400);
        expect(rot.body.message).toMatch(/^Week 2 — /);
    });

    it('a member\'s hours with a malformed period list are refused, not a server error', async () => {
        const { login } = await team();
        const res = await request(app).put('/api/team/mine/availability').set(authHeader(login))
            .send({ schedule: { monday: { enabled: true, slots: { start: '09:00', end: '17:00' } } } });
        expect(res.status).toBe(400);
    });

    it('whatever an older screen sends today is still accepted: one period, days off, untouched days', async () => {
        const { login } = await team();
        const old = {
            monday: { enabled: true, slots: [{ start: '09:00', end: '17:00' }] },
            tuesday: { enabled: false, slots: [{ start: '09:00', end: '17:00' }] },
            sunday: { enabled: false, slots: [] },
        };
        await request(app).put('/api/team/mine/availability').set(authHeader(login)).send({ schedule: old }).expect(200);
    });
});

describe('the gap between the periods is closed', () => {
    const shop = async () => {
        const owner = await makeProvider();
        await Availability.create({ provider: owner._id, schedule: splitWeek() });
        const svc = await makeService(owner._id, { duration: 30 });
        const customer = await makeUser();
        return { owner, svc, customer };
    };
    const book = (ctx, startTime, endTime, extra = {}) => request(app).post('/api/appointments').set(authHeader(ctx.customer))
        .send({ service: ctx.svc._id.toString(), appointmentDate: DATE, startTime, endTime, ...extra });

    it('bookings: inside either period yes; in the gap, or across it, no', async () => {
        const ctx = await shop();
        expect((await book(ctx, '11:30', '12:00')).status).toBe(201);
        expect((await book(ctx, '14:00', '14:30')).status).toBe(201);
        expect((await book(ctx, '12:30', '13:00')).status).toBe(400);
        expect((await book(ctx, '11:45', '14:15')).status).toBe(400);
    });

    it('a member\'s split day: their hours, their time list and their bookings all keep the gap', async () => {
        const ctx = await shop();
        await Availability.updateOne({ provider: ctx.owner._id }, { $set: { schedule: everyDayHours('07:00', '20:00') } });
        const member = await TeamMember.create({ provider: ctx.owner._id, name: 'Erastus' });
        await StaffAvailability.create({ provider: ctx.owner._id, teamMember: member._id, schedule: splitWeek() });

        const hours = (await request(app).get(`/api/team/${member._id}/hours`).query({ date: DATE }).set(authHeader(ctx.owner)).expect(200)).body.data;
        expect(hours.slots).toEqual([{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }]);

        const slots = (await request(app).get('/api/appointments/booked-slots')
            .query({ providerId: ctx.owner._id.toString(), date: DATE, teamMember: member._id.toString() })).body;
        expect(slots.data).toEqual(expect.arrayContaining([{ startTime: '12:00', endTime: '14:00', kind: 'off_shift' }]));
        expect(slots.openings).toEqual(['08:00', '14:00']);

        expect((await book(ctx, '14:00', '14:30', { teamMember: member._id.toString() })).status).toBe(201);
        expect((await book(ctx, '12:30', '13:00', { teamMember: member._id.toString() })).status).toBe(400);
    });
});
