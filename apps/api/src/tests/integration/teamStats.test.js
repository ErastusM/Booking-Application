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

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

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
    // at 09:00, a 15:00 booking read as already past.
    it('counts a booking later today as upcoming', async () => {
        const { provider, service, member } = await setup();
        const customer = await makeUser();
        const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
        await makeAppointment(customer._id, service._id, provider._id, {
            teamMember: member._id, status: 'confirmed',
            appointmentDate: todayMidnight, startTime: '23:30', endTime: '23:59',
        });

        const res = await statsFor(provider, member);

        expect(res.body.data.upcoming).toBe(1);
    });

    it('refuses another provider\'s team member', async () => {
        const { member } = await setup();
        const intruder = await makeProvider();

        const res = await request(app).get(`/api/team/${member._id}/stats`).set(authHeader(intruder));

        expect(res.status).toBe(404);
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
