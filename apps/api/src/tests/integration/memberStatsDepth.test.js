/**
 * Per-member stats DEPTH: no-show rate, cancellations, a period-over-period
 * trend, and the staff self-view endpoint (/api/team/mine/stats).
 *
 *   noShowRate = no-shows / (completed + no-shows)   (cancellations excluded —
 *   a cancelled booking was called off ahead of time, not a no-show)
 *   trend      = the same metrics for the immediately-preceding equal window
 *
 * The self-view returns the SAME figures the owner sees for that member, scoped
 * to the employer, so a staff member can read their own numbers without the
 * owner endpoint (which stays owner-only).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// Dates at local midnight, in the past, so bookings land inside the window.
const daysAgo = (k) => { const d = new Date(); d.setDate(d.getDate() - k); d.setHours(0, 0, 0, 0); return d; };
const yesterday = () => daysAgo(1);
// 40 days back falls in the PRIOR 30-day window ([today-59 .. today-30]).
const priorWindow = () => daysAgo(40);

const setup = async () => {
    const provider = await makeProvider();
    const service = await makeService(provider._id);
    const member = await TeamMember.create({ provider: provider._id, name: 'Moses', role: 'Barber' });
    const customer = await makeUser();
    return { provider, service, member, customer };
};
const seed = (customer, service, provider, member, over) =>
    makeAppointment(customer._id, service._id, provider._id, {
        teamMember: member._id, startTime: '10:00', endTime: '11:00', appointmentDate: yesterday(), ...over,
    });
const ownerStats = (provider, member) =>
    request(app).get(`/api/team/${member._id}/stats`).set(authHeader(provider));

describe('no-show + cancellation + rate', () => {
    it('counts no-shows and cancellations and computes the no-show rate', async () => {
        const { provider, service, member, customer } = await setup();
        await seed(customer, service, provider, member, { status: 'completed', totalPrice: 200 });
        await seed(customer, service, provider, member, { status: 'completed', totalPrice: 150, startTime: '12:00', endTime: '12:30' });
        await seed(customer, service, provider, member, { status: 'no-show', startTime: '13:00', endTime: '13:30' });
        await seed(customer, service, provider, member, { status: 'cancelled', startTime: '14:00', endTime: '14:30' });

        const res = await ownerStats(provider, member);
        expect(res.status).toBe(200);
        expect(res.body.data.appointments).toBe(2); // completed only
        expect(res.body.data.noShows).toBe(1);
        expect(res.body.data.cancellations).toBe(1);
        // 1 no-show out of (2 completed + 1 no-show) attendable = 33%.
        expect(res.body.data.noShowRate).toBe(33);
    });

    it('no-show rate is null when there were no attendable bookings', async () => {
        const { provider, member } = await setup();
        const res = await ownerStats(provider, member);
        expect(res.status).toBe(200);
        expect(res.body.data.noShows).toBe(0);
        expect(res.body.data.noShowRate).toBeNull();
    });
});

describe('period-over-period trend', () => {
    it('reports the prior window and the deltas', async () => {
        const { provider, service, member, customer } = await setup();
        // Current window: 2 completed = 350.
        await seed(customer, service, provider, member, { status: 'completed', totalPrice: 200 });
        await seed(customer, service, provider, member, { status: 'completed', totalPrice: 150, startTime: '12:00', endTime: '12:30' });
        // Prior window: 1 completed = 100.
        await seed(customer, service, provider, member, { status: 'completed', totalPrice: 100, appointmentDate: priorWindow() });

        const res = await ownerStats(provider, member);
        expect(res.status).toBe(200);
        expect(res.body.data.revenue).toBe(350);
        expect(res.body.data.trend.revenuePrev).toBe(100);
        expect(res.body.data.trend.revenueDelta).toBe(250);
        expect(res.body.data.trend.appointmentsPrev).toBe(1);
        expect(res.body.data.trend.appointmentsDelta).toBe(1);
    });
});

describe('staff self-view — /api/team/mine/stats', () => {
    it("returns the member's OWN figures, matching the owner endpoint", async () => {
        const { provider, service, member, customer } = await setup();
        await seed(customer, service, provider, member, { status: 'completed', totalPrice: 200 });
        await seed(customer, service, provider, member, { status: 'no-show', startTime: '13:00', endTime: '13:30' });
        // Link a staff login to this member's row.
        const login = await makeUser({ role: 'staff', staffOf: provider._id, email: 'moses@test.com' });
        await TeamMember.updateOne({ _id: member._id }, { $set: { user: login._id } });

        const mine = await request(app).get('/api/team/mine/stats').set(authHeader(login));
        expect(mine.status).toBe(200);
        expect(mine.body.data.revenue).toBe(200);
        expect(mine.body.data.noShows).toBe(1);

        const owner = await ownerStats(provider, member);
        expect(mine.body.data.revenue).toBe(owner.body.data.revenue);
        expect(mine.body.data.noShows).toBe(owner.body.data.noShows);
        expect(mine.body.data.noShowRate).toBe(owner.body.data.noShowRate);
    });

    it('a provider (no staff profile) gets 404 on the self-view', async () => {
        const { provider } = await setup();
        const res = await request(app).get('/api/team/mine/stats').set(authHeader(provider));
        expect(res.status).toBe(404);
    });

    it("a staff member cannot read a colleague's stats via the owner endpoint", async () => {
        const { provider, member } = await setup();
        const colleague = await TeamMember.create({ provider: provider._id, name: 'Other' });
        const login = await makeUser({ role: 'staff', staffOf: provider._id, email: 'staff2@test.com' });
        await TeamMember.updateOne({ _id: member._id }, { $set: { user: login._id } });
        // The owner /:id/stats route is gated to provider/admin — a staff token is refused.
        const res = await request(app).get(`/api/team/${colleague._id}/stats`).set(authHeader(login));
        expect([401, 403]).toContain(res.status);
    });
});
