/**
 * Recurring / rotating (multi-week) staff schedules.
 *
 * StaffAvailability gains an optional `rotation` = { anchor, weeks[] }. When
 * weeks is non-empty the booking resolver uses weeks[weekIndex] for a date
 * (weekIndex = floor(daysSince(anchor)/7) mod weeks.length) INSTEAD of the flat
 * `schedule`; an empty rotation (every legacy row) is byte-identical to the
 * single-week behaviour. This suite pins:
 *   - the ON week books, the OFF week is refused ("outside working hours")
 *   - a per-date Shift still overrides whichever rotation week the date lands on
 *   - an empty rotation behaves exactly like the flat schedule (back-compat)
 *   - the named-member booked-slots picker agrees with the validator (off week
 *     = off_shift), so a slot is never advertised then refused
 *   - CRUD validates every rotation week and never silently wipes a rotation on
 *     a legacy { schedule } write
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Shift = require('../../models/Shift');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

// Next strictly-future Wednesday, from local parts to match the controller's
// new Date(date).getDay() weekday derivation (same convention as staffBookingMath).
const nextFutureWednesday = () => {
    const d = new Date();
    d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7 || 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DATE = nextFutureWednesday();
// The exact weekday key the resolver will read for DATE — build week objects
// against THIS key so the test holds regardless of the runner's timezone.
const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(DATE).getDay()];
// A week that works DATE's weekday 09:00–17:00, and one that is fully off.
const workingWeek = { [WD]: { enabled: true, slots: [{ start: '09:00', end: '17:00' }] } };
const offWeek = { [WD]: { enabled: false, slots: [] } };
// Anchor exactly on DATE → week 0. Anchor 7 days earlier → week 1.
const minus7 = (dateStr) => new Date(Date.parse(`${dateStr}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);

const book = (asUser, svc, { teamMember, startTime = '10:00', endTime = '10:30' } = {}) =>
    request(app).post('/api/appointments').set(authHeader(asUser))
        .send({ service: svc._id.toString(), appointmentDate: DATE, startTime, endTime, teamMember });

const setup = async () => {
    const owner = await makeProvider();
    const svc = await makeService(owner._id);
    const customer = await makeUser();
    const a = await TeamMember.create({ provider: owner._id, name: 'Alice' });
    const b = await TeamMember.create({ provider: owner._id, name: 'Bob' });
    return { owner, svc, customer, a, b };
};

describe('rotation resolver — the applicable week governs the booking', () => {
    it('books on the ON week and refuses on the OFF week of the same date', async () => {
        const { owner, svc, customer, a, b } = await setup();
        // A: [working, off] anchored on DATE → week 0 = working.
        await StaffAvailability.create({
            provider: owner._id, teamMember: a._id, schedule: workingWeek,
            rotation: { anchor: DATE, weeks: [workingWeek, offWeek] },
        });
        // B: same cycle but anchored 7 days earlier → DATE is week 1 = off.
        await StaffAvailability.create({
            provider: owner._id, teamMember: b._id, schedule: workingWeek,
            rotation: { anchor: minus7(DATE), weeks: [workingWeek, offWeek] },
        });

        const onWeek = await book(customer, svc, { teamMember: a._id });
        expect(onWeek.status).toBe(201);

        const offWeekRes = await book(customer, svc, { teamMember: b._id });
        expect(offWeekRes.status).toBe(400);
        expect(offWeekRes.body.message).toMatch(/working hours/i);
    });

    it('a per-date Shift overrides the rotation week (works on an OFF week)', async () => {
        const { owner, svc, customer, b } = await setup();
        await StaffAvailability.create({
            provider: owner._id, teamMember: b._id, schedule: workingWeek,
            rotation: { anchor: minus7(DATE), weeks: [workingWeek, offWeek] }, // DATE = off week
        });
        // A shift for DATE rosters them on 09:00–17:00, replacing the off week.
        await Shift.create({ provider: owner._id, teamMember: b._id, date: DATE, slots: [{ start: '09:00', end: '17:00' }] });

        const res = await book(customer, svc, { teamMember: b._id });
        expect(res.status).toBe(201);
    });

    it('an empty rotation behaves exactly like the flat schedule (back-compat)', async () => {
        const { owner, svc, customer, a, b } = await setup();
        // A: flat working week, rotation left empty → books.
        await StaffAvailability.create({ provider: owner._id, teamMember: a._id, schedule: workingWeek });
        // B: flat schedule that does NOT enable DATE's weekday → refused, unchanged.
        await StaffAvailability.create({
            provider: owner._id, teamMember: b._id,
            schedule: { [WD]: { enabled: false, slots: [] } },
        });

        expect((await book(customer, svc, { teamMember: a._id })).status).toBe(201);
        const refused = await book(customer, svc, { teamMember: b._id });
        expect(refused.status).toBe(400);
        expect(refused.body.message).toMatch(/working hours/i);
    });
});

describe('rotation — booked-slots picker agrees with the validator', () => {
    it('the OFF-week member shows the day as off_shift (advertised == bookable)', async () => {
        const { owner, a, b } = await setup();
        // Two bookable members so the named-member weekly branch runs (a solo
        // owner is intentionally skipped by the picker).
        await StaffAvailability.create({
            provider: owner._id, teamMember: a._id, schedule: workingWeek,
            rotation: { anchor: DATE, weeks: [workingWeek, offWeek] }, // on week
        });
        await StaffAvailability.create({
            provider: owner._id, teamMember: b._id, schedule: workingWeek,
            rotation: { anchor: minus7(DATE), weeks: [workingWeek, offWeek] }, // off week
        });

        const res = await request(app)
            .get('/api/appointments/booked-slots')
            .query({ providerId: owner._id.toString(), date: DATE, teamMember: b._id.toString() });
        expect(res.status).toBe(200);
        const offShift = res.body.data.filter((x) => x.kind === 'off_shift');
        // The whole day is off for the off-week member.
        expect(offShift.some((x) => x.startTime === '00:00' && x.endTime === '23:59')).toBe(true);
    });
});

describe('rotation CRUD — validation + no silent wipe', () => {
    const putAvail = (owner, member, body) =>
        request(app).put(`/api/team/${member._id}/availability`).set(authHeader(owner)).send(body);

    it('accepts a valid rotation and returns it on read', async () => {
        const owner = await makeProvider();
        const m = await TeamMember.create({ provider: owner._id, name: 'Mia' });
        const put = await putAvail(owner, m, {
            schedule: workingWeek,
            rotation: { anchor: DATE, weeks: [workingWeek, offWeek] },
        });
        expect(put.status).toBe(200);
        expect(put.body.data.rotation.weeks).toHaveLength(2);

        const get = await request(app).get(`/api/team/${m._id}/availability`).set(authHeader(owner));
        expect(get.body.data.rotation.weeks).toHaveLength(2);
        expect(get.body.data.rotation.anchor).toBe(DATE);
    });

    it('rejects a rotation week with an inverted slot, and a cycle with no anchor', async () => {
        const owner = await makeProvider();
        const m = await TeamMember.create({ provider: owner._id, name: 'Mia' });

        const inverted = await putAvail(owner, m, {
            schedule: workingWeek,
            rotation: { anchor: DATE, weeks: [workingWeek, { [WD]: { enabled: true, slots: [{ start: '17:00', end: '09:00' }] } }] },
        });
        expect(inverted.status).toBe(400);
        expect(inverted.body.message).toMatch(/week 2/i);

        const noAnchor = await putAvail(owner, m, {
            schedule: workingWeek,
            rotation: { anchor: '', weeks: [workingWeek, offWeek] },
        });
        expect(noAnchor.status).toBe(400);
        expect(noAnchor.body.message).toMatch(/start date/i);
    });

    it('a legacy { schedule }-only write does NOT wipe an existing rotation', async () => {
        const owner = await makeProvider();
        const m = await TeamMember.create({ provider: owner._id, name: 'Mia' });
        await putAvail(owner, m, { schedule: workingWeek, rotation: { anchor: DATE, weeks: [workingWeek, offWeek] } });

        // Old client sends only { schedule } — rotation key absent.
        const legacy = await putAvail(owner, m, { schedule: workingWeek });
        expect(legacy.status).toBe(200);
        expect(legacy.body.data.rotation.weeks).toHaveLength(2); // preserved

        // Explicitly clearing (rotation: null) turns it off.
        const cleared = await putAvail(owner, m, { schedule: workingWeek, rotation: null });
        expect(cleared.status).toBe(200);
        expect(cleared.body.data.rotation.weeks).toHaveLength(0);
    });
});
