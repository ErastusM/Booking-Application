/**
 * The Overview tab's numbers.
 *
 * "Occupancy" and "retention" mean different things at different businesses, so
 * these pin the definitions the API actually implements rather than leaving
 * them to be re-guessed later:
 *
 *   occupancy = booked minutes / scheduled minutes
 *   retention = clients who booked more than once / clients who booked at all
 *
 * And they pin the distinction that matters most on a dashboard: a metric with
 * no answer is null, never 0. "We cannot say" and "they did none" are different
 * facts and must not render the same.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const Shift = require('../../models/Shift');
const { NAMIBIA_OFFSET_MIN } = require('../../utils/appointmentTime');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// The stats window is anchored to the business day in Africa/Windhoek, expressed
// at UTC-midnight (how appointmentDate is stored). Build fixture dates the same
// way, or a booking made "today" is dropped for the two hours after local
// midnight when UTC hasn't rolled over yet.
const DAYS7 = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const namTodayUtcMidnight = () => {
    const n = new Date(Date.now() + NAMIBIA_OFFSET_MIN * 60 * 1000);
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};
const namDaysAgoKey = (k) => { const d = namTodayUtcMidnight(); d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };
// Yesterday, so bookings are inside the window and safely in the past.
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0); return d; };

const setup = async () => {
    const provider = await makeProvider();
    const service = await makeService(provider._id);
    const member = await TeamMember.create({ provider: provider._id, name: 'Moses Hamalwa', role: 'Barber' });
    return { provider, service, member };
};

const statsFor = (provider, member) =>
    request(app).get(`/api/team/${member._id}/stats`).set(authHeader(provider));

describe('team member stats', () => {
    it('counts completed work and the revenue it generated', async () => {
        const { provider, service, member } = await setup();
        const customer = await makeUser();
        await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'completed', totalPrice: 200,
            appointmentDate: yesterday(), startTime: '10:00', endTime: '11:00',
        });
        await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'completed', totalPrice: 150,
            appointmentDate: yesterday(), startTime: '12:00', endTime: '12:30',
        });

        const res = await statsFor(provider, member);

        expect(res.status).toBe(200);
        expect(res.body.data.appointments).toBe(2);
        expect(res.body.data.revenue).toBe(350);
        expect(res.body.data.bookedMinutes).toBe(90);
    });

    it('ignores another team member\'s bookings', async () => {
        const { provider, service, member } = await setup();
        const other = await TeamMember.create({ provider: provider._id, name: 'Sarah Nangolo' });
        const customer = await makeUser();
        await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: other._id, status: 'completed', totalPrice: 999, appointmentDate: yesterday(),
        });

        const res = await statsFor(provider, member);

        expect(res.body.data.appointments).toBe(0);
        expect(res.body.data.revenue).toBe(0);
    });

    it('counts a repeat client as retention, a one-off as not', async () => {
        const { provider, service, member } = await setup();
        const repeat = await makeUser();
        const once = await makeUser();
        for (const [c, t] of [[repeat, '09:00'], [repeat, '10:00'], [once, '11:00']]) {
            await makeAppointment(c._id, service._id, provider._id, {
                teamMember: member._id, status: 'completed', totalPrice: 100,
                appointmentDate: yesterday(), startTime: t, endTime: t.replace(':00', ':30'),
            });
        }

        const res = await statsFor(provider, member);

        expect(res.body.data.clients).toBe(2);      // two distinct people
        expect(res.body.data.retention).toBe(50);   // one of the two came back
    });

    // Guests have no account, so two guest bookings cannot be known to be the
    // same person — counting them would invent a retention figure.
    it('excludes guests from the client and retention counts', async () => {
        const { provider, service, member } = await setup();
        await makeAppointment(null, service._id, provider._id, {
            teamMember: member._id, status: 'completed', totalPrice: 100,
            appointmentDate: yesterday(), guestName: 'Walk-in', guestEmail: 'w@x.com',
        });

        const res = await statsFor(provider, member);

        expect(res.body.data.appointments).toBe(1);   // the work still counts
        expect(res.body.data.clients).toBe(0);        // but not as a known client
        expect(res.body.data.retention).toBeNull();
    });

    it('reports occupancy against the member\'s own hours', async () => {
        const { provider, service, member } = await setup();
        const customer = await makeUser();
        // Two hours a day, every day, so the window's scheduled minutes are known.
        const everyDay = {};
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            .forEach((d) => { everyDay[d] = { enabled: true, slots: [{ start: '09:00', end: '11:00' }] }; });
        await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule: everyDay });

        await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'completed', totalPrice: 100,
            appointmentDate: yesterday(), startTime: '09:00', endTime: '10:00',
        });

        const res = await request(app)
            .get(`/api/team/${member._id}/stats?days=10`)
            .set(authHeader(provider));

        expect(res.body.data.scheduledMinutes).toBe(10 * 120);
        expect(res.body.data.bookedMinutes).toBe(60);
        expect(res.body.data.occupancy).toBe(5);      // 60 / 1200
    });

    // The distinction the dashboard depends on: nothing scheduled is "cannot
    // say", not "was idle all week".
    it('reports occupancy as null when nothing is scheduled', async () => {
        const { provider, member } = await setup();
        const empty = {};
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            .forEach((d) => { empty[d] = { enabled: false, slots: [] }; });
        await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule: empty });

        const res = await statsFor(provider, member);

        expect(res.body.data.occupancy).toBeNull();
    });

    // appointmentDate is a date-only value stored at midnight. Counting
    // "upcoming" from `now` therefore dropped everything still to come today —
    // at 09:00, a 15:00 booking read as already past. Today is the Windhoek day
    // at UTC-midnight, matching how the window and appointmentDate are built.
    it('counts a booking later today as upcoming', async () => {
        const { provider, service, member } = await setup();
        const customer = await makeUser();
        await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'confirmed',
            appointmentDate: namTodayUtcMidnight(), startTime: '23:30', endTime: '23:59',
        });

        const res = await statsFor(provider, member);

        expect(res.body.data.upcoming).toBe(1);
    });

    // Occupancy is shift-aware: a date-specific shift REPLACES the weekly pattern
    // for its day (models/Shift), so a rostered day off is zero scheduled time,
    // not a full day that drags the figure down.
    it('treats a rostered day off as zero scheduled minutes, not a full day', async () => {
        const { provider, member } = await setup();
        const everyDay = {};
        DAYS7.forEach((d) => { everyDay[d] = { enabled: true, slots: [{ start: '09:00', end: '17:00' }] }; }); // 480/day
        await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule: everyDay });
        // One in-window date rostered off.
        await Shift.create({ provider: provider._id, teamMember: member._id, date: namDaysAgoKey(1), slots: [] });

        const res = await request(app)
            .get(`/api/team/${member._id}/stats?days=3`)
            .set(authHeader(provider));

        // Three days at 480, minus the single day off.
        expect(res.body.data.scheduledMinutes).toBe(3 * 480 - 480);
    });

    // A working shift counts its OWN hours minus its breaks, not the pattern's.
    it('counts a shift\'s own hours, less its breaks', async () => {
        const { provider, member } = await setup();
        const everyDay = {};
        DAYS7.forEach((d) => { everyDay[d] = { enabled: true, slots: [{ start: '09:00', end: '17:00' }] }; }); // 480/day
        await StaffAvailability.create({ provider: provider._id, teamMember: member._id, schedule: everyDay });
        // That day: a 10:00–14:00 shift (240) with a 30-minute break = 210.
        await Shift.create({
            provider: provider._id, teamMember: member._id, date: namDaysAgoKey(1),
            slots: [{ start: '10:00', end: '14:00' }],
            breaks: [{ start: '12:00', end: '12:30', label: 'Lunch' }],
        });

        const res = await request(app)
            .get(`/api/team/${member._id}/stats?days=3`)
            .set(authHeader(provider));

        // Two pattern days at 480, plus the shift day at 240 − 30.
        expect(res.body.data.scheduledMinutes).toBe(2 * 480 + 210);
    });

    it('refuses another provider\'s team member', async () => {
        const { member } = await setup();
        const intruder = await makeProvider();

        const res = await request(app).get(`/api/team/${member._id}/stats`).set(authHeader(intruder));

        expect(res.status).toBe(404);
    });
});

// A multi-service booking splits across staff — each services[] entry has its
// own member, price and minutes. The stats used to credit the whole ticket to
// the top-level member, so the primary's revenue and occupancy were inflated
// and every other performer saw nothing.
describe('multi-service attribution', () => {
    const seg = (service, price, startTime, endTime, teamMember) =>
        ({ service, name: 'Seg', price, duration: 60, startTime, endTime, teamMember });

    it('credits each performer only their own service, not the whole ticket', async () => {
        const { provider, service, member } = await setup();
        const other = await TeamMember.create({ provider: provider._id, name: 'Sarah Nangolo' });
        const customer = await makeUser();
        // One booking, two services: member 10:00–11:00 (N$100), other 11:00–12:00
        // (N$200). Top-level = member, whole-ticket totalPrice = 300.
        await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'completed', totalPrice: 300,
            appointmentDate: yesterday(), startTime: '10:00', endTime: '12:00',
            services: [
                seg(service._id, 100, '10:00', '11:00', member._id),
                seg(service._id, 200, '11:00', '12:00', other._id),
            ],
        });

        const mine = await statsFor(provider, member);
        expect(mine.body.data.revenue).toBe(100);       // not the 300 whole ticket
        expect(mine.body.data.bookedMinutes).toBe(60);  // not the full 120 span
        expect(mine.body.data.appointments).toBe(1);

        // The second performer is credited even though they are not the top-level
        // member — previously they were invisible to their own stats.
        const theirs = await statsFor(provider, other);
        expect(theirs.body.data.revenue).toBe(200);
        expect(theirs.body.data.bookedMinutes).toBe(60);
        expect(theirs.body.data.appointments).toBe(1);
    });

    it('still credits the whole price for an ordinary single-service booking', async () => {
        const { provider, service, member } = await setup();
        const customer = await makeUser();
        await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'completed', totalPrice: 150,
            appointmentDate: yesterday(), startTime: '09:00', endTime: '10:00',
        });

        const res = await statsFor(provider, member);
        expect(res.body.data.revenue).toBe(150);
        expect(res.body.data.bookedMinutes).toBe(60);
    });
});

describe('bookable', () => {
    it('keeps a non-bookable member off the bookable roster', async () => {
        const { provider, member } = await setup();

        await request(app)
            .put(`/api/team/${member._id}`)
            .set(authHeader(provider))
            .send({ bookable: false });

        // utils/staffBooking resolves candidates from isActive + bookable, so
        // a receptionist is on the team but never offered to a client.
        const offered = await TeamMember.find({ provider: provider._id, isActive: true, bookable: true });
        expect(offered.map((m) => m._id.toString())).not.toContain(member._id.toString());
        // Still very much on the team.
        expect((await TeamMember.findById(member._id)).isActive).toBe(true);
    });

    it('defaults to bookable so existing rosters are unchanged', async () => {
        const { member } = await setup();
        expect((await TeamMember.findById(member._id)).bookable).toBe(true);
    });
});
