/**
 * GET /api/team/hours — everyone's working hours for a few days, in one request.
 *
 * The owner's answer: "Yes. Own hours." — in the Staff view each member's lane
 * is shaded by that member's own hours, not the business's. The calendar gets
 * them here, once per day shown rather than once per lane per render, by the
 * SAME rules as the single-person GET /api/team/:id/hours (and bookings):
 * leave → shift → weekly hours within the business's → none (closed). The
 * owner's column is the business's Working Hours.
 */
process.env.TZ = 'UTC';

const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { futureDate } = require('../helpers/dates');
const { makeProvider, makeUser, makeAdmin, authHeader, everyDayHours, giveHours } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const Availability = require('../../models/Availability');
const Shift = require('../../models/Shift');
const TimeOff = require('../../models/TimeOff');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const WED = futureDate(0);
const THU = futureDate(1);
const FRI = futureDate(2);
const batch = (user, query) => request(app).get('/api/team/hours').query(query).set(authHeader(user));
const single = (user, id, date) => request(app).get(`/api/team/${id}/hours`).query({ date }).set(authHeader(user));

// Vido Barber, open 08:00–18:00. Erastus works a split day (08:00–12:00,
// 14:00–18:00), has a shift on Thursday and leave on Friday; John has no hours;
// Hilda has left (archived) but works 09:00–17:00.
const shop = async () => {
    const owner = await makeProvider({ name: 'Vido Barber' });
    await Availability.create({ provider: owner._id, schedule: everyDayHours('08:00', '18:00') });
    const erastus = await TeamMember.create({ provider: owner._id, name: 'Erastus' });
    const john = await TeamMember.create({ provider: owner._id, name: 'John' });
    const hilda = await TeamMember.create({ provider: owner._id, name: 'Hilda', isActive: false });
    const splitDay = Object.fromEntries(Object.keys(everyDayHours()).map((d) => [d, { enabled: true, slots: [{ start: '14:00', end: '18:00' }, { start: '08:00', end: '12:00' }] }]));
    await giveHours(erastus, splitDay);
    await giveHours(hilda, everyDayHours('09:00', '17:00'));
    await Shift.create({ provider: owner._id, teamMember: erastus._id, date: THU, slots: [{ start: '10:00', end: '19:00' }], breaks: [{ start: '13:00', end: '13:30' }] });
    await TimeOff.create({ provider: owner._id, teamMember: erastus._id, startDate: FRI, endDate: FRI, allDay: true, status: 'approved', type: 'vacation' });
    return { owner, erastus, john, hilda };
};

describe('GET /api/team/hours', () => {
    it('gives the owner every person\'s hours for each day — the same as the one-person endpoint', async () => {
        const { owner, erastus, john, hilda } = await shop();
        const res = await batch(owner, { from: WED, to: FRI }).expect(200);
        const { data } = res.body;
        expect(Object.keys(data.owner)).toEqual([WED, THU, FRI]);
        expect(Object.keys(data.members).sort()).toEqual([erastus, john, hilda].map((m) => String(m._id)).sort());

        for (const date of [WED, THU, FRI]) {
            for (const [id, who] of [['owner', 'owner'], [String(erastus._id), erastus._id], [String(john._id), john._id], [String(hilda._id), hilda._id]]) {
                const one = (await single(owner, who, date).expect(200)).body.data;
                const fromBatch = id === 'owner' ? data.owner[date] : data.members[id][date];
                expect(fromBatch).toEqual(one);
            }
        }
    });

    it('a split day keeps its gap; a shift, leave and "no hours" read as bookings do', async () => {
        const { owner, erastus, john } = await shop();
        const { data } = (await batch(owner, { from: WED, to: FRI, ids: `owner,${erastus._id},${john._id}` }).expect(200)).body;
        const e = data.members[String(erastus._id)];
        expect(e[WED]).toMatchObject({ source: 'weekly', slots: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }] });
        expect(e[THU]).toMatchObject({ source: 'shift', slots: [{ start: '10:00', end: '19:00' }], busy: [{ startTime: '13:00', endTime: '13:30', kind: 'break' }] });
        expect(e[FRI]).toMatchObject({ source: 'leave', slots: [] });
        expect(data.members[String(john._id)][WED]).toMatchObject({ source: 'none', slots: [] });
        expect(data.owner[WED]).toMatchObject({ source: 'business', slots: [{ start: '08:00', end: '18:00' }] });
    });

    it('only returns what was asked for', async () => {
        const { owner, john } = await shop();
        const { data } = (await batch(owner, { from: WED, to: WED, ids: String(john._id) }).expect(200)).body;
        expect(data.owner).toBeUndefined();
        expect(Object.keys(data.members)).toEqual([String(john._id)]);
    });

    it('is scoped to the caller\'s business: another business\'s member is left out', async () => {
        const { owner, erastus } = await shop();
        const other = await makeProvider();
        const theirs = await TeamMember.create({ provider: other._id, name: 'Not Yours' });
        await giveHours(theirs);
        const { data } = (await batch(owner, { from: WED, to: WED, ids: `${erastus._id},${theirs._id}` }).expect(200)).body;
        expect(Object.keys(data.members)).toEqual([String(erastus._id)]);
        // …and the other owner can't read Vido Barber's people either.
        const cross = (await batch(other, { from: WED, to: WED, ids: String(erastus._id) }).expect(200)).body.data;
        expect(cross.members).toEqual({});
    });

    it('a team member gets only themselves and the owner\'s column', async () => {
        const { owner, erastus, john } = await shop();
        const login = await makeUser({ role: 'staff', staffOf: owner._id, email: 'erastus@test.com' });
        await TeamMember.updateOne({ _id: erastus._id }, { $set: { user: login._id } });

        const all = (await batch(login, { from: WED, to: WED }).expect(200)).body.data;
        expect(Object.keys(all.members)).toEqual([String(erastus._id)]);
        expect(all.mine).toBe(String(erastus._id));
        expect(all.owner[WED].source).toBe('business');

        const asked = (await batch(login, { from: WED, to: WED, ids: `mine,${john._id}` }).expect(200)).body.data;
        expect(Object.keys(asked.members)).toEqual([String(erastus._id)]);
        expect(asked.owner).toBeUndefined();
    });

    it('checks the dates, the range (at most 7 days) and who is asking', async () => {
        const { owner } = await shop();
        await batch(owner, { from: WED, to: '2026-13-01' }).expect(400);
        await batch(owner, { from: FRI, to: WED }).expect(400);
        await batch(owner, { from: WED, to: futureDate(7) }).expect(400);
        await batch(owner, { from: WED, to: futureDate(6) }).expect(200);
        await batch(owner, { from: WED, to: WED, ids: 'not-an-id' }).expect(400);
        await batch(await makeUser(), { from: WED, to: WED }).expect(403);
        const admin = await makeAdmin();
        await batch(admin, { from: WED, to: WED }).expect(403);
        const viaAdmin = (await batch(admin, { from: WED, to: WED, provider: String(owner._id) }).expect(200)).body.data;
        expect(Object.keys(viaAdmin.members)).toHaveLength(3);
        await request(app).get('/api/team/hours').query({ from: WED, to: WED }).expect(401);
    });
});
