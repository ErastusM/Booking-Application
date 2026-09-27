/**
 * A business's ONLY bookable team member, on every path.
 *
 * From #121 until now such a member was booked over the business's (the
 * owner's) hours instead of their own. The owner's report — "Moses didn't set
 * blocked times but he's getting the times of the business owner": the calendar
 * filtered to Moses, the only team member, was closed every Monday because the
 * business is — and their answer: "only their own". So a lone member is like
 * any other member:
 *
 *   - lone member WITH hours of their own → THEIR hours, even on a day (or at
 *     an hour) the business is closed; never capped by the business's;
 *   - lone member with NO hours of their own → not bookable anywhere (D2);
 *   - a shift and approved leave apply to them as to anyone.
 *
 * Every path that decides "who is bookable, when" must agree: named and "any
 * available" bookings, the booking page's busy list and date picker, the
 * any-professional view, search, GET /team/:id/hours (and the batch the Staff
 * view shades from), reschedules and recurring series.
 */
process.env.TZ = 'UTC';

const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { futureDate } = require('../helpers/dates');
const { makeProvider, makeUser, makeService, authHeader, everyDayHours, giveHours } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Availability = require('../../models/Availability');
const Appointment = require('../../models/Appointment');
const Shift = require('../../models/Shift');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DATE = futureDate(0);
const NEXT = futureDate(7);
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const offered = (busy, start, length) => !busy.some((b) => mins(start) < mins(b.endTime) && mins(start) + length > mins(b.startTime));

// Vido Barber is open 08:00–20:00; Lina, its one team member, works 09:00–17:00.
// `closedOn` closes the business (the owner) on that weekday.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const weekdayOf = (key) => WEEKDAYS[new Date(`${key}T00:00:00.000Z`).getUTCDay()];
const shop = async ({ hours = everyDayHours('09:00', '17:00'), closedOn = null } = {}) => {
    const owner = await makeProvider({ name: 'Vido Barber' });
    const business = everyDayHours('08:00', '20:00');
    if (closedOn) business[closedOn] = { enabled: false, slots: [] };
    await Availability.create({ provider: owner._id, schedule: business });
    const svc = await makeService(owner._id, { name: 'Cut', duration: 60, ownerPerforms: false });
    const lina = await TeamMember.create({ provider: owner._id, name: 'Lina', offersAllServices: true });
    if (hours) await giveHours(lina, hours);
    const customer = await makeUser();
    return { owner, svc, lina, customer };
};
const book = (ctx, body) => request(app).post('/api/appointments').set(authHeader(ctx.customer))
    .send({ service: String(ctx.svc._id), appointmentDate: DATE, startTime: '18:00', endTime: '19:00', ...body });
const slots = (ctx, query) => request(app).get('/api/appointments/booked-slots')
    .query({ providerId: String(ctx.owner._id), date: DATE, ...query }).then((r) => r.body);

describe('the only bookable member, with hours of their own: THEIR hours, never the business\'s', () => {
    it('is refused at 18:00 (past her own day, inside the business\'s) — by name and "any available"; booked inside her hours', async () => {
        const ctx = await shop();
        expect((await book(ctx, { teamMember: String(ctx.lina._id) })).status).toBe(400);
        expect((await book(ctx, {})).status).toBe(400);
        const any = await book(ctx, { startTime: '09:00', endTime: '10:00' });
        expect(any.status).toBe(201);
        expect(String(any.body.data.teamMember)).toBe(String(ctx.lina._id));
    });

    it('the booking page offers what is accepted: her own day, 09:00 opening included', async () => {
        const ctx = await shop();
        const named = await slots(ctx, { teamMember: String(ctx.lina._id), service: String(ctx.svc._id) });
        expect(named.hoursSource).toBe('weekly');
        expect(named.memberHasHours).toBe(true);
        expect(offered(named.data, '18:00', 60)).toBe(false);
        expect(offered(named.data, '09:00', 60)).toBe(true);
        expect(named.openings).toEqual(['09:00']);
        expect(named.memberWindow).toEqual([{ start: '09:00', end: '17:00' }]);
        const any = await slots(ctx, { service: String(ctx.svc._id), duration: 60 });
        expect(any.openStarts).toEqual([{ start: '09:00', end: '16:00' }]);
        expect(any.openings).toEqual(['09:00']);
    });

    it('her hours for New Appointment and the Staff view are her own', async () => {
        const ctx = await shop();
        const one = await request(app).get(`/api/team/${ctx.lina._id}/hours`).query({ date: DATE }).set(authHeader(ctx.owner));
        expect(one.body.data.source).toBe('weekly');
        expect(one.body.data.slots).toEqual([{ start: '09:00', end: '17:00' }]);
        const all = await request(app).get('/api/team/hours').query({ from: DATE, to: DATE }).set(authHeader(ctx.owner));
        expect(all.body.data.members[String(ctx.lina._id)][DATE]).toEqual(one.body.data);
    });

    it('the date picker follows her own week, and search finds her day but not the business\'s evening', async () => {
        const monOnly = await shop({ hours: { monday: { enabled: true, slots: [{ start: '09:00', end: '17:00' }] } } });
        const days = await request(app).get(`/api/providers/${monOnly.owner._id}/staff/${monOnly.lina._id}/shift-days`).query({ from: DATE, to: NEXT });
        const keys = [];
        for (let d = new Date(`${DATE}T00:00:00.000Z`); d.toISOString().slice(0, 10) <= NEXT; d.setUTCDate(d.getUTCDate() + 1)) keys.push(d.toISOString().slice(0, 10));
        expect(days.body.data.working.sort()).toEqual(keys.filter((k) => weekdayOf(k) === 'monday'));
        expect(days.body.data.off.sort()).toEqual(keys.filter((k) => weekdayOf(k) !== 'monday'));
        await testDb.clearDatabase();

        const ctx = await shop();
        const evening = await request(app).get('/api/providers/search').query({ date: DATE, time: '18:00' });
        expect(evening.body.data.find((r) => r.provider === String(ctx.owner._id))).toBeUndefined();
        const morning = await request(app).get('/api/providers/search').query({ date: DATE, time: '10:00' });
        expect(morning.body.data.find((r) => r.provider === String(ctx.owner._id))?.openings?.[0]).toBe('10:00');
    });

    it('a reschedule and a weekly series follow her own hours', async () => {
        const ctx = await shop();
        const first = await book(ctx, { teamMember: String(ctx.lina._id), startTime: '10:00', endTime: '11:00' });
        expect(first.status).toBe(201);
        const late = await request(app).put(`/api/appointments/${first.body.data._id}/reschedule`).set(authHeader(ctx.customer))
            .send({ appointmentDate: DATE, startTime: '18:00' });
        expect(late.status).toBe(400);
        const moved = await request(app).put(`/api/appointments/${first.body.data._id}/reschedule`).set(authHeader(ctx.customer))
            .send({ appointmentDate: DATE, startTime: '15:00' });
        expect(moved.status).toBe(200);
        const series = await book(ctx, {
            teamMember: String(ctx.lina._id), appointmentDate: futureDate(1), startTime: '14:00', endTime: '15:00',
            isRecurring: true, recurrenceType: 'weekly', recurrenceInterval: 1, recurrenceEndDate: futureDate(15),
        });
        expect(series.status).toBe(201);
        expect(series.body.skippedDates || []).toEqual([]);
        expect(await Appointment.countDocuments({ recurrenceGroupId: series.body.data.recurrenceGroupId })).toBe(3);
    });

    it('a shift still replaces her week for its date', async () => {
        const ctx = await shop();
        await Shift.create({ provider: ctx.owner._id, teamMember: ctx.lina._id, date: DATE, slots: [{ start: '12:00', end: '16:00' }] });
        expect((await book(ctx, { teamMember: String(ctx.lina._id) })).status).toBe(400);
        expect((await book(ctx, { teamMember: String(ctx.lina._id), startTime: '12:00', endTime: '13:00' })).status).toBe(201);
    });

    it('with a colleague on the roster, each works their own hours again', async () => {
        const ctx = await shop();
        const john = await TeamMember.create({ provider: ctx.owner._id, name: 'John', offersAllServices: true });
        await giveHours(john, everyDayHours('09:00', '17:00'));
        const named = await book(ctx, { teamMember: String(ctx.lina._id) });
        expect(named.status).toBe(400);
        expect(named.body.message).toMatch(/outside this staff member's working hours/);
        expect((await slots(ctx, { teamMember: String(ctx.lina._id) })).hoursSource).toBe('weekly');
    });
});

// The owner's report: the business is closed on Mondays, Moses (its only team
// member) works them — and the calendar filtered to Moses showed Monday closed.
describe('the only bookable member works a day the business (owner) is closed', () => {
    it('is bookable that day by name and "any available", and every view says so', async () => {
        const ctx = await shop({ hours: everyDayHours('09:00', '17:00'), closedOn: weekdayOf(DATE) });
        const named = await book(ctx, { teamMember: String(ctx.lina._id), startTime: '10:00', endTime: '11:00' });
        expect(named.status).toBe(201);
        const any = await book(ctx, { startTime: '11:00', endTime: '12:00' });
        expect(any.status).toBe(201);
        expect(String(any.body.data.teamMember)).toBe(String(ctx.lina._id));
        // Still her own hours: past 17:00 is refused.
        expect((await book(ctx, { teamMember: String(ctx.lina._id), startTime: '17:00', endTime: '18:00' })).status).toBe(400);

        const day = await slots(ctx, { teamMember: String(ctx.lina._id), service: String(ctx.svc._id) });
        expect(day.hoursSource).toBe('weekly');
        expect(day.memberWindow).toEqual([{ start: '09:00', end: '17:00' }]);
        expect(offered(day.data, '14:00', 60)).toBe(true);
        const anyView = await slots(ctx, { service: String(ctx.svc._id), duration: 60 });
        expect(anyView.openStarts).toEqual([{ start: '09:00', end: '09:00' }, { start: '12:00', end: '16:00' }]);

        const one = await request(app).get(`/api/team/${ctx.lina._id}/hours`).query({ date: DATE }).set(authHeader(ctx.owner));
        expect(one.body.data).toMatchObject({ source: 'weekly', slots: [{ start: '09:00', end: '17:00' }], business: [] });
        const all = await request(app).get('/api/team/hours').query({ from: DATE, to: DATE }).set(authHeader(ctx.owner));
        expect(all.body.data.owner[DATE].slots).toEqual([]); // the owner's own column stays closed
        expect(all.body.data.members[String(ctx.lina._id)][DATE].slots).toEqual([{ start: '09:00', end: '17:00' }]);

        const days = await request(app).get(`/api/providers/${ctx.owner._id}/staff/${ctx.lina._id}/shift-days`).query({ from: DATE, to: DATE });
        expect(days.body.data).toEqual({ working: [DATE], off: [] });
        const found = await request(app).get('/api/providers/search').query({ date: DATE, time: '12:00' });
        expect(found.body.data.find((r) => r.provider === String(ctx.owner._id))?.openings?.[0]).toBe('12:00');
    });
});

describe('the only bookable member with NO hours of their own: not bookable (the owner\'s answer)', () => {
    it('is refused by name and "any available", and every view says so', async () => {
        const ctx = await shop({ hours: null });
        const named = await book(ctx, { teamMember: String(ctx.lina._id) });
        expect(named.status).toBe(400);
        expect(named.body.message).toBe('That staff member has no working hours set for that day.');
        expect((await book(ctx, {})).status).toBe(400);

        const day = await slots(ctx, { teamMember: String(ctx.lina._id) });
        expect(day.hoursSource).toBe('none');
        expect(day.memberHasHours).toBe(false);
        expect(day.openings).toEqual([]);
        const one = await request(app).get(`/api/team/${ctx.lina._id}/hours`).query({ date: DATE }).set(authHeader(ctx.owner));
        expect(one.body.data.source).toBe('none');
        const days = await request(app).get(`/api/providers/${ctx.owner._id}/staff/${ctx.lina._id}/shift-days`).query({ from: DATE, to: DATE });
        expect(days.body.data).toEqual({ working: [], off: [DATE] });
    });

    it('a shift ahead is hours of their own: bookable on it, and not "without hours"', async () => {
        const ctx = await shop({ hours: null });
        await Shift.create({ provider: ctx.owner._id, teamMember: ctx.lina._id, date: NEXT, slots: [{ start: '09:00', end: '13:00' }] });
        const day = await slots(ctx, { teamMember: String(ctx.lina._id) });
        expect(day.hoursSource).toBe('none');
        expect(day.memberHasHours).toBe(true); // just not on this day
        expect((await book(ctx, { teamMember: String(ctx.lina._id), appointmentDate: NEXT, startTime: '09:00', endTime: '10:00' })).status).toBe(201);
    });
});
