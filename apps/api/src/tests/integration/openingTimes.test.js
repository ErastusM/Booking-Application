/**
 * Every working period's exact opening time is offered — and accepted.
 *
 * The owner's answer: "Yes" — if you open at 08:30, 08:30 is always offered when
 * the service fits before that period closes, not only when it ends by 09:00.
 * The same goes for each period of a split day (14:30 after a lunch break) and a
 * team member's own periods. The time lists are built on the client, so the
 * server now tells it the day's opening times (booked-slots `openings`), search
 * offers them next to its 30-minute grid, and — the half that matters most — the
 * booking validator accepts them (it only ever checked that a booking fits inside
 * the hours, never a grid, so nothing it accepted before is refused now).
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
const Shift = require('../../models/Shift');
const { searchAvailability } = require('../../utils/availabilitySearch');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DATE = futureDate(0); // a Wednesday
const split = (a, b, c, d) => Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .map((day) => [day, { enabled: true, slots: [{ start: a, end: b }, { start: c, end: d }] }])
);

const slots = (provider, extra = {}) => request(app).get('/api/appointments/booked-slots')
    .query({ providerId: provider._id.toString(), date: DATE, ...extra }).then((r) => r.body);
const book = (ctx, startTime, endTime, extra = {}) => request(app).post('/api/appointments').set(authHeader(ctx.customer))
    .send({ service: ctx.svc._id.toString(), appointmentDate: DATE, startTime, endTime, ...extra });

// Open 08:30–12:00 and 14:30–18:00; a 45-minute service.
const splitShop = async () => {
    const provider = await makeProvider();
    await Availability.create({ provider: provider._id, schedule: split('08:30', '12:00', '14:30', '18:00') });
    const svc = await makeService(provider._id, { duration: 45 });
    const customer = await makeUser();
    return { provider, svc, customer };
};

describe('booked-slots tells the time list each period\'s opening time', () => {
    it('the business\'s own periods (no roster, and the owner\'s column)', async () => {
        const ctx = await splitShop();
        expect((await slots(ctx.provider)).openings).toEqual(['08:30', '14:30']);
        await giveHours(await TeamMember.create({ provider: ctx.provider._id, name: 'Erastus' }));
        expect((await slots(ctx.provider, { teamMember: 'owner' })).openings).toEqual(['08:30', '14:30']);
    });

    it('a member\'s own weekly periods — their own, not capped by the business\'s', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: everyDayHours('08:00', '18:00') });
        const erastus = await TeamMember.create({ provider: provider._id, name: 'Erastus' });
        await giveHours(erastus, split('07:00', '12:00', '14:15', '19:00'));
        await giveHours(await TeamMember.create({ provider: provider._id, name: 'Hilda' }));
        const body = await slots(provider, { teamMember: erastus._id.toString() });
        // 07:00 is before the business (owner) opens — his own day starts then.
        expect(body.openings).toEqual(['07:00', '14:15']);
        expect(body.memberWindow).toEqual([{ start: '07:00', end: '12:00' }, { start: '14:15', end: '19:00' }]);
        expect(body.hoursSource).toBe('weekly');
    });

    it('never an old shift\'s periods — the weekly ones', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: everyDayHours('08:00', '18:00') });
        const erastus = await TeamMember.create({ provider: provider._id, name: 'Erastus' });
        await giveHours(erastus, everyDayHours('08:00', '19:00'));
        await Shift.create({ provider: provider._id, teamMember: erastus._id, date: DATE, slots: [{ start: '09:15', end: '12:00' }, { start: '17:30', end: '21:00' }] });
        expect((await slots(provider, { teamMember: erastus._id.toString() })).openings).toEqual(['08:00']);
    });

    it('none for a member with no hours that day', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: everyDayHours('08:00', '18:00') });
        const john = await TeamMember.create({ provider: provider._id, name: 'John' });
        expect((await slots(provider, { teamMember: john._id.toString() })).openings).toEqual([]);
    });

    it('"any professional": every performer\'s own openings (the business\'s hours are the owner\'s)', async () => {
        const ctx = await splitShop();
        const a = await TeamMember.create({ provider: ctx.provider._id, name: 'A' });
        const b = await TeamMember.create({ provider: ctx.provider._id, name: 'B' });
        await giveHours(a, split('08:45', '11:00', '15:10', '17:00'));
        await giveHours(b, everyDayHours('08:00', '18:00'));
        const body = await slots(ctx.provider, { service: ctx.svc._id.toString() });
        expect(body.hoursSource).toBe('any');
        expect(body.openings).toEqual(['08:00', '08:45', '15:10']);
    });
});

describe('the server accepts every opening time it offers', () => {
    it('the owner\'s column: 08:30 for a 45-minute service, and the split day\'s 14:30', async () => {
        const ctx = await splitShop();
        expect((await book(ctx, '08:30', '09:15')).status).toBe(201);
        expect((await book(ctx, '14:30', '15:15')).status).toBe(201);
        // The gap between the periods is still closed, and so is a start that
        // doesn't fit before a period closes.
        expect((await book(ctx, '12:30', '13:15')).status).toBe(400);
        expect((await book(ctx, '11:30', '12:15')).status).toBe(400);
    });

    it('a named member at their own openings (08:15, and 14:30 after their break)', async () => {
        const ctx = await splitShop();
        await Availability.updateOne({ provider: ctx.provider._id }, { $set: { schedule: everyDayHours('08:00', '18:00') } });
        const erastus = await TeamMember.create({ provider: ctx.provider._id, name: 'Erastus' });
        await giveHours(erastus, split('08:15', '12:00', '14:30', '18:00'));
        // A colleague: the business's ONLY bookable member works its hours instead.
        await giveHours(await TeamMember.create({ provider: ctx.provider._id, name: 'Hilda' }));
        expect((await book(ctx, '08:15', '09:00', { teamMember: erastus._id.toString() })).status).toBe(201);
        expect((await book(ctx, '14:30', '15:15', { teamMember: erastus._id.toString() })).status).toBe(201);
        expect((await book(ctx, '12:30', '13:15', { teamMember: erastus._id.toString() })).status).toBe(400);
    });

    it('"any available" at a split day\'s 14:30', async () => {
        const ctx = await splitShop();
        const erastus = await TeamMember.create({ provider: ctx.provider._id, name: 'Erastus' });
        await giveHours(erastus, split('08:30', '12:00', '14:30', '18:00'));
        const res = await book(ctx, '14:30', '15:15');
        expect(res.status).toBe(201);
        expect(String(res.body.data.teamMember)).toBe(String(erastus._id));
    });
});

describe('search offers each opening time next to its 30-minute grid', () => {
    it('an 08:15 business opening, and a member\'s 14:45 period opening', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: split('08:15', '09:00', '14:00', '18:00') });
        await makeService(provider._id, { duration: 30, ownerPerforms: false });
        const erastus = await TeamMember.create({ provider: provider._id, name: 'Erastus' });
        await giveHours(erastus, split('08:15', '09:00', '14:45', '18:00'));
        // A colleague in from 16:00 (the business's ONLY bookable member would
        // work the business's hours instead of their own).
        await giveHours(await TeamMember.create({ provider: provider._id, name: 'Hilda' }), everyDayHours('16:00', '18:00'));

        const [hit] = (await searchAvailability({ date: DATE, duration: 30, maxOpenings: 10 }))
            .filter((r) => r.provider === String(provider._id));
        // 08:15 (the opening, off the grid), 08:30 (grid); then 14:45 — the member's
        // own opening — and the grid after it. Never 14:00/14:30: he isn't in yet.
        expect(hit.openings.slice(0, 4)).toEqual(['08:15', '08:30', '14:45', '15:00']);
    });
});
