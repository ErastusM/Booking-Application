/**
 * Re-audit batch B — MEDIUM correctness (availability / scheduling):
 *   1. Marketplace availability search ignored approved time-off, surfacing
 *      openings the booking flow then rejects. It now mirrors the booking
 *      validator (leave → weekly hours; old Shift rows are ignored).
 *   2. getBookedSlots' "any professional" view re-emitted OWNER-ONLY blocks as
 *      'blocked', greying out slots the team can still take. Now none of the
 *      owner's blocks are re-emitted (they never close a team member).
 *   (The availability-search past-slot floor is also computed in Namibia local time
 *   now, not server-UTC — not unit-tested here as it depends on wall-clock "now".)
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { searchAvailability } = require('../../utils/availabilitySearch');
const { makeProvider, makeService, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Availability = require('../../models/Availability');
const BlockedTime = require('../../models/BlockedTime');
const Shift = require('../../models/Shift');
const TimeOff = require('../../models/TimeOff');

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
const ymd = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const soon = () => { const d = new Date(); d.setDate(d.getDate() + 21); return ymd(d); };

// A provider with business hours, one roster member (Alice) on a full weekly
// schedule, and a service. Alice performs all services (no `services` filter);
// the owner doesn't perform this one, so search's owner column (offered next to
// the team whenever the owner performs something) can't cover for her.
const shopWithAlice = async () => {
    const provider = await makeProvider();
    await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
    const svc = await makeService(provider._id, { duration: 30, ownerPerforms: false });
    const alice = await TeamMember.create({ provider: provider._id, name: 'Alice', isActive: true });
    await StaffAvailability.create({ provider: provider._id, teamMember: alice._id, schedule: everyDay('08:00', '19:00') });
    return { provider, svc, alice };
};

describe('B1 — availability search honours approved leave, ignores old shifts', () => {
    it('excludes a provider whose only member is on approved all-day leave', async () => {
        const { provider, alice } = await shopWithAlice();
        const date = soon();

        // Control: with no leave, the provider surfaces openings.
        let results = await searchAvailability({ date, duration: 30 });
        expect(results.some(r => r.provider === provider._id.toString())).toBe(true);

        await TimeOff.create({
            provider: provider._id, teamMember: alice._id, status: 'approved',
            startDate: date, endDate: date, allDay: true,
        });
        results = await searchAvailability({ date, duration: 30 });
        expect(results.some(r => r.provider === provider._id.toString())).toBe(false);
    });

    it('an old date-specific shift does not narrow the weekly hours', async () => {
        const { provider, alice } = await shopWithAlice();
        const date = soon();
        // An old shift says 10:00–11:00; her weekly hours are 08:00–19:00.
        await Shift.create({ provider: provider._id, teamMember: alice._id, date, slots: [{ start: '10:00', end: '11:00' }], breaks: [] });

        const results = await searchAvailability({ date, duration: 30 });
        const mine = results.find(r => r.provider === provider._id.toString());
        expect(mine).toBeTruthy();
        expect(mine.openings[0]).toBe('08:00'); // the weekly hours govern
    });
});

describe('B2 — any-professional slot view does not leak the owner\'s blocks', () => {
    it('re-emits neither an owner-only block nor a legacy business-wide one — the owner\'s blocks never close the team', async () => {
        const { provider, svc } = await shopWithAlice();
        const date = soon();
        // The owner's personal time must NOT close the team's slots…
        await BlockedTime.create({ provider: provider._id, date, teamMember: null, ownerOnly: true, startTime: '12:00', endTime: '13:00' });
        // …and neither does a legacy "business-wide" row: it is the owner's too.
        await BlockedTime.create({ provider: provider._id, date, teamMember: null, ownerOnly: false, startTime: '14:00', endTime: '15:00' });

        const res = await request(app).get('/api/appointments/booked-slots')
            .query({ providerId: provider._id.toString(), date, service: svc._id.toString() });
        expect(res.status).toBe(200);

        const blockedStarts = res.body.data.filter(d => d.kind === 'blocked').map(d => d.startTime);
        expect(blockedStarts).not.toContain('14:00');
        expect(blockedStarts).not.toContain('12:00');
    });
});
