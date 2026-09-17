/**
 * The customer's calendar greys the days a member doesn't work.
 *
 * Per-member weekly hours were already enforced when a booking was submitted,
 * and the TIME picker already greyed the hours outside them. But the DAY picker
 * only knew about hand-rostered shifts and approved leave, so a member who
 * simply doesn't work Mondays showed Monday as selectable — the customer found
 * out by opening it to a wall of unavailable times.
 *
 * This pins the day list to the same rule the booking validator applies.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Shift = require('../../models/Shift');
const { makeProvider } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const open = { enabled: true, slots: [{ start: '08:00', end: '17:00' }] };
const shut = { enabled: false, slots: [] };
// Mon-Fri only. Sundays and Saturdays off.
const weekdaysOnly = {
    sunday: shut, monday: open, tuesday: open, wednesday: open,
    thursday: open, friday: open, saturday: shut,
};

// Two bookable members: the solo-member exception (a lone member inherits
// business hours) must not swallow the case under test.
const setup = async (schedule) => {
    const owner = await makeProvider();
    const erastus = await TeamMember.create({ provider: owner._id, name: 'Erastus', role: 'Barber', email: 'e@test.com', isActive: true });
    await TeamMember.create({ provider: owner._id, name: 'John', role: 'Barber', email: 'j@test.com', isActive: true });
    if (schedule) await StaffAvailability.create({ provider: owner._id, teamMember: erastus._id, schedule });
    return { owner, erastus };
};

const days = (res) => ({ working: res.body.data.working, off: res.body.data.off });

describe('GET /api/providers/:id/staff/:memberId/shift-days — weekly hours', () => {
    it('reports the days a member works and the days they do not', async () => {
        const { owner, erastus } = await setup(weekdaysOnly);

        // Mon 2026-09-14 .. Sun 2026-09-20.
        const res = await request(app)
            .get(`/api/providers/${owner._id}/staff/${erastus._id}/shift-days?from=2026-09-14&to=2026-09-20`);

        expect(res.status).toBe(200);
        const { working, off } = days(res);
        expect(working).toEqual(expect.arrayContaining(['2026-09-14', '2026-09-18']));  // Mon, Fri
        expect(off).toEqual(expect.arrayContaining(['2026-09-19', '2026-09-20']));      // Sat, Sun
        expect(working).not.toEqual(expect.arrayContaining(['2026-09-19', '2026-09-20']));
    });

    it('a hand-rostered shift still wins over the weekly schedule', async () => {
        const { owner, erastus } = await setup(weekdaysOnly);
        // Rostered ON a Saturday he normally has off...
        await Shift.create({ provider: owner._id, teamMember: erastus._id, date: '2026-09-19', slots: [{ start: '09:00', end: '13:00' }] });
        // ...and OFF a Monday he normally works (an empty shift = rostered day off).
        await Shift.create({ provider: owner._id, teamMember: erastus._id, date: '2026-09-14', slots: [] });

        const res = await request(app)
            .get(`/api/providers/${owner._id}/staff/${erastus._id}/shift-days?from=2026-09-14&to=2026-09-20`);

        const { working, off } = days(res);
        expect(working).toContain('2026-09-19');
        expect(off).toContain('2026-09-14');
    });

    it('a member with no weekly schedule inherits business hours — nothing is narrowed', async () => {
        const { owner, erastus } = await setup(null);

        const res = await request(app)
            .get(`/api/providers/${owner._id}/staff/${erastus._id}/shift-days?from=2026-09-14&to=2026-09-20`);

        // No opinion either way: the client falls back to the business's days.
        expect(days(res)).toEqual({ working: [], off: [] });
    });

    it('a SOLO bookable member is not narrowed — the validator ignores their weekly hours', async () => {
        const owner = await makeProvider();
        const solo = await TeamMember.create({ provider: owner._id, name: 'Solo', role: 'Barber', email: 's@test.com', isActive: true });
        await StaffAvailability.create({ provider: owner._id, teamMember: solo._id, schedule: weekdaysOnly });

        const res = await request(app)
            .get(`/api/providers/${owner._id}/staff/${solo._id}/shift-days?from=2026-09-14&to=2026-09-20`);

        // Narrowing here would close days the booking would actually accept.
        expect(days(res)).toEqual({ working: [], off: [] });
    });

    it('approved leave still wins over a weekly working day', async () => {
        const { owner, erastus } = await setup(weekdaysOnly);
        const TimeOff = require('../../models/TimeOff');
        await TimeOff.create({
            provider: owner._id, teamMember: erastus._id, status: 'approved', allDay: true,
            startDate: '2026-09-16', endDate: '2026-09-16', reason: 'Leave',
        });

        const res = await request(app)
            .get(`/api/providers/${owner._id}/staff/${erastus._id}/shift-days?from=2026-09-14&to=2026-09-20`);

        const { working, off } = days(res);
        expect(off).toContain('2026-09-16');       // Wednesday, normally a working day
        expect(working).not.toContain('2026-09-16');
    });
});
