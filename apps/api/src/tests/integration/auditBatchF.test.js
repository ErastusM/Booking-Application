/**
 * Re-audit batch F — LOW correctness:
 *   F1 (#14). Monthly recurring blocked-time expansion drifted for day-of-month
 *             29–31 (setMonth overflow: Jan 31 → Mar 3, skipping February). Now
 *             clamped to each month's length.
 *   F2 (#10). Earnings-by-team-member credited the whole multi-service ticket to
 *             the primary member; now attributed per segment.
 *   F4 (#7).  Admin updateAppointment reschedule skipped the blocked-time / staff
 *             guards + the race backstop every other reschedule path runs. Now at
 *             parity — an admin move onto blocked time is refused.
 * (#6 recurring-occurrence buffer symmetry and #16 reminder-flag restore-on-rollback
 *  are behaviour-preserving guards exercised by the recurring + reschedule suites.)
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { _generateOccurrences } = require('../../controllers/blockedTimeController');
const { makeProvider, makeService, makeAdmin, makeAppointment, authHeader } = require('../helpers/factories');
const Appointment = require('../../models/Appointment');
const TeamMember = require('../../models/TeamMember');
const Availability = require('../../models/Availability');
const BlockedTime = require('../../models/BlockedTime');

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

describe('F1 — monthly recurring occurrences clamp to month-end (no drift/skip)', () => {
    it('a block starting on the 31st lands on the last day of short months, never spills over', () => {
        const dates = _generateOccurrences('2026-01-31', 'monthly', '2026-06-30');
        // Jan 31 → Feb 28 (not Mar 3) → Mar 31 → Apr 30 → May 31 → Jun 30.
        expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
        // February must be present, and nothing lands on Mar 3 (the old overflow date).
        expect(dates).toContain('2026-02-28');
        expect(dates).not.toContain('2026-03-03');
    });

    it('leap February gets the 29th', () => {
        const dates = _generateOccurrences('2028-01-31', 'monthly', '2028-02-29');
        expect(dates).toEqual(['2028-01-31', '2028-02-29']);
    });
});

describe('F2 — earnings by team member are attributed per segment', () => {
    it('credits each performer their own segment, not the whole ticket to the primary', async () => {
        const provider = await makeProvider();
        const s1 = await makeService(provider._id, { price: 30 });
        const s2 = await makeService(provider._id, { price: 50 });
        const alice = await TeamMember.create({ provider: provider._id, name: 'Alice', isActive: true });

        // A completed multi-service ticket: owner does s1 (30), Alice does s2 (50).
        await Appointment.create({
            provider: provider._id, service: s1._id, teamMember: null,
            appointmentDate: new Date(), startTime: '10:00', endTime: '11:00',
            totalPrice: 80, status: 'completed', walkInName: 'Ticket',
            services: [
                { service: s1._id, name: 'S1', price: 30, teamMember: null, startTime: '10:00', endTime: '10:30' },
                { service: s2._id, name: 'S2', price: 50, teamMember: alice._id, startTime: '10:30', endTime: '11:00' },
            ],
        });

        const res = await request(app).get('/api/earnings').set(authHeader(provider));
        expect(res.status).toBe(200);
        const byTM = res.body.data.byTeamMember;
        const aliceRow = byTM.find(r => r.name === 'Alice');
        const ownerRow = byTM.find(r => r.name === 'Unassigned');
        expect(aliceRow).toBeTruthy();
        expect(aliceRow.earned).toBe(50);   // her segment only, not 80
        expect(ownerRow.earned).toBe(30);   // the owner's segment
    });
});

describe('F4 — admin reschedule respects blocked time (parity with other paths)', () => {
    it('refuses an admin move onto provider blocked time', async () => {
        const provider = await makeProvider();
        await Availability.create({ provider: provider._id, schedule: everyDay('08:00', '19:00') });
        const svc = await makeService(provider._id, { duration: 30 });
        const admin = await makeAdmin();

        const appt = await makeAppointment(null, svc._id, provider._id, {
            customer: null, walkInName: 'Guest', startTime: '10:00', endTime: '10:30', status: 'confirmed',
        });
        const date = ymd(new Date(appt.appointmentDate));
        // Provider blocks 14:00–15:00 that day.
        await BlockedTime.create({ provider: provider._id, date, teamMember: null, startTime: '14:00', endTime: '15:00' });

        // Admin tries to move the booking onto the blocked window.
        const res = await request(app).put(`/api/appointments/${appt._id}`).set(authHeader(admin))
            .send({ appointmentDate: appt.appointmentDate, startTime: '14:00', endTime: '14:30' });
        expect(res.status).toBe(400);

        // The booking must NOT have moved.
        const after = await Appointment.findById(appt._id);
        expect(after.startTime).toBe('10:00');
    });
});
