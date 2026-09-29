/**
 * Regression: an old shift must not override a member's Working Hours.
 *
 * The owner's report: Moses's Working Hours say Wednesday 08:00–19:00, but the
 * calendar filtered to Moses hatched Wednesday 17:00–19:00 as unavailable. An
 * old date-specific Shift (08:00–17:00), saved before the Shifts screen was
 * removed, was still replacing his weekly hours for that date — and there was
 * no screen left to see or remove it.
 *
 * The rule now: a member's bookable hours are their weekly Working Hours only,
 * minus blocked time in their lane and approved time off. Shift rows are kept
 * but ignored everywhere.
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
const BlockedTime = require('../../models/BlockedTime');
const TimeOff = require('../../models/TimeOff');
const Shift = require('../../models/Shift');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const WED = futureDate(0); // a Wednesday
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const covers = (busy, start, end) => busy.some((b) => mins(b.startTime) < mins(end) && mins(b.endTime) > mins(start));

// The owner's business closes at 17:00; Moses works Wednesday 08:00–19:00, and
// has an old 08:00–17:00 shift row for this Wednesday.
const shop = async () => {
    const owner = await makeProvider({ name: 'Vido Barber' });
    await Availability.create({ provider: owner._id, schedule: everyDayHours('08:00', '17:00') });
    const svc = await makeService(owner._id, { name: 'Cut', duration: 30, ownerPerforms: false });
    const moses = await TeamMember.create({ provider: owner._id, name: 'Moses', offersAllServices: true });
    const week = Object.fromEntries(Object.keys(everyDayHours()).map((d) => [d, { enabled: false, slots: [] }]));
    week.wednesday = { enabled: true, slots: [{ start: '08:00', end: '19:00' }] };
    await giveHours(moses, week);
    await Shift.create({ provider: owner._id, teamMember: moses._id, date: WED, slots: [{ start: '08:00', end: '17:00' }] });
    const customer = await makeUser();
    return { owner, svc, moses, customer };
};
const book = (ctx, startTime, endTime) => request(app).post('/api/appointments').set(authHeader(ctx.customer))
    .send({ service: String(ctx.svc._id), appointmentDate: WED, startTime, endTime, teamMember: String(ctx.moses._id) });
const bookedSlots = (ctx, query) => request(app).get('/api/appointments/booked-slots')
    .query({ providerId: String(ctx.owner._id), date: WED, ...query }).then((r) => r.body);

describe("Moses's Wednesday: weekly 08:00–19:00 wins over an old 08:00–17:00 shift", () => {
    it('the calendar shading (/api/team/hours) shows 08:00–19:00, nothing hatched after 17:00', async () => {
        const ctx = await shop();
        const res = await request(app).get('/api/team/hours')
            .query({ from: WED, to: WED, ids: String(ctx.moses._id) }).set(authHeader(ctx.owner)).expect(200);
        const day = res.body.data.members[String(ctx.moses._id)][WED];
        expect(day).toMatchObject({ source: 'weekly', slots: [{ start: '08:00', end: '19:00' }], busy: [] });

        const one = await request(app).get(`/api/team/${ctx.moses._id}/hours`).query({ date: WED }).set(authHeader(ctx.owner)).expect(200);
        expect(one.body.data).toEqual(day);
    });

    it('17:00–19:00 is bookable, and the booking page offers it', async () => {
        const ctx = await shop();
        const view = await bookedSlots(ctx, { teamMember: String(ctx.moses._id) });
        expect(view.hoursSource).toBe('weekly');
        expect(view.shiftWindow).toBeNull();
        expect(view.memberWindow).toEqual([{ start: '08:00', end: '19:00' }]);
        expect(covers(view.data, '17:00', '19:00')).toBe(false);

        const res = await book(ctx, '17:30', '18:00');
        expect(res.status).toBe(201);
        expect(String(res.body.data.teamMember)).toBe(String(ctx.moses._id));
        // Past his weekly hours is still refused.
        expect((await book(ctx, '19:00', '19:30')).status).toBe(400);
    });

    it('"any professional" offers 17:00–19:00 too', async () => {
        const ctx = await shop();
        const view = await bookedSlots(ctx, { service: String(ctx.svc._id), duration: 30 });
        expect(view.hoursSource).toBe('any');
        expect(covers(view.data, '17:00', '19:00')).toBe(false);
        expect(view.openStarts.some((r) => mins(r.start) <= mins('18:00') && mins(r.end) >= mins('18:00'))).toBe(true);
    });

    it('blocked time in his lane and approved time off still close his time', async () => {
        const ctx = await shop();
        await BlockedTime.create({ provider: ctx.owner._id, teamMember: ctx.moses._id, date: WED, startTime: '17:00', endTime: '18:00' });
        expect((await book(ctx, '17:00', '17:30')).status).toBe(400);
        expect((await book(ctx, '18:00', '18:30')).status).toBe(201);

        await TimeOff.create({ provider: ctx.owner._id, teamMember: ctx.moses._id, startDate: WED, endDate: WED, allDay: false, startTime: '18:30', endTime: '19:00', status: 'approved' });
        expect((await book(ctx, '18:30', '19:00')).status).toBe(400);
        expect(await Appointment.countDocuments({ teamMember: ctx.moses._id })).toBe(1);
    });

    it('the shift row itself is kept — nothing is deleted', async () => {
        const ctx = await shop();
        await book(ctx, '17:30', '18:00');
        expect(await Shift.countDocuments({ teamMember: ctx.moses._id })).toBe(1);
    });
});

describe('readiness counts weekly hours only', () => {
    it('a member with only a future shift is "not taking bookings"', async () => {
        const ctx = await shop();
        const shiftOnly = await TeamMember.create({ provider: ctx.owner._id, name: 'Shift Only', offersAllServices: true });
        await Shift.create({ provider: ctx.owner._id, teamMember: shiftOnly._id, date: WED, slots: [{ start: '09:00', end: '13:00' }] });

        const tiles = (await request(app).get(`/api/providers/${ctx.owner._id}/staff`)).body.data;
        const by = Object.fromEntries(tiles.map((m) => [m.name, m.hasHours]));
        expect(by).toMatchObject({ Moses: true, 'Shift Only': false });

        const team = (await request(app).get('/api/team').set(authHeader(ctx.owner))).body.data;
        expect(team.find((m) => m.name === 'Shift Only').hasHours).toBe(false);
    });
});
