/**
 * Earnings reporting integration tests.
 * Earnings reflect COMPLETED appointments only and are scoped per provider.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const TeamMember = require('../../models/TeamMember');
const {
    makeUser, makeProvider,
    makeService, makeAppointment,
    authHeader,
} = require('../helpers/factories');

// A date safely inside the default 30-day reporting range and in the past, so it
// lands in the range-scoped aggregations (by service / staff / client, over time).
const inRangeDate = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('GET /api/earnings', () => {
    it('sums only completed appointments into totals', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100 });

        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', totalPrice: 100 });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', totalPrice: 150 });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'pending', totalPrice: 999 });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'cancelled', totalPrice: 999 });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'no-show', totalPrice: 999 });

        const res = await request(app)
            .get('/api/earnings')
            .set(authHeader(provider));

        expect(res.status).toBe(200);
        expect(res.body.data.totals.allTimeEarned).toBe(250);
        expect(res.body.data.totals.allTimeCount).toBe(2);
    });

    it('does not leak earnings across providers', async () => {
        const customer = await makeUser();
        const providerA = await makeProvider();
        const providerB = await makeProvider();
        const svcA = await makeService(providerA._id, { price: 100 });
        const svcB = await makeService(providerB._id, { price: 100 });

        await makeAppointment(customer._id, svcA._id, providerA._id, { status: 'completed', totalPrice: 100 });
        await makeAppointment(customer._id, svcB._id, providerB._id, { status: 'completed', totalPrice: 500 });

        const res = await request(app)
            .get('/api/earnings')
            .set(authHeader(providerA));

        expect(res.status).toBe(200);
        expect(res.body.data.totals.allTimeEarned).toBe(100);
    });

    it('rejects customers', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .get('/api/earnings')
            .set(authHeader(customer));
        expect(res.status).toBe(403);
    });

    it('respects the from/to date range', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100 });

        const inRange = new Date('2026-03-15');
        const outOfRange = new Date('2026-01-10');
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', totalPrice: 100, appointmentDate: inRange });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', totalPrice: 200, appointmentDate: outOfRange });

        const res = await request(app)
            .get('/api/earnings?from=2026-03-01&to=2026-03-31')
            .set(authHeader(provider));

        expect(res.status).toBe(200);
        expect(res.body.data.totals.earned).toBe(100); // range total excludes January
        expect(res.body.data.totals.allTimeEarned).toBe(300); // all-time still counts both
    });

    it('breaks earnings down by team member when staff are assigned', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100 });
        const alex = await TeamMember.create({ provider: provider._id, name: 'Alex' });
        const sam = await TeamMember.create({ provider: provider._id, name: 'Sam' });

        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', totalPrice: 100, appointmentDate: inRangeDate(), teamMember: alex._id });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', totalPrice: 150, appointmentDate: inRangeDate(), teamMember: alex._id });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', totalPrice: 60, appointmentDate: inRangeDate(), teamMember: sam._id });

        const res = await request(app)
            .get('/api/earnings')
            .set(authHeader(provider));

        expect(res.status).toBe(200);
        const byTeam = res.body.data.byTeamMember;
        expect(byTeam).toHaveLength(2);
        // Sorted by earned desc: Alex (250) then Sam (60).
        expect(byTeam[0]).toMatchObject({ name: 'Alex', earned: 250, count: 2 });
        expect(byTeam[1]).toMatchObject({ name: 'Sam', earned: 60, count: 1 });
    });

    it('returns an empty team breakdown for a solo provider (no staff assigned)', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100 });

        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', totalPrice: 100, appointmentDate: inRangeDate() });

        const res = await request(app)
            .get('/api/earnings')
            .set(authHeader(provider));

        expect(res.status).toBe(200);
        expect(res.body.data.byTeamMember).toEqual([]);
    });

    it('labels guests by name and counts distinct guests separately', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100 });

        // Two visits from one guest, one visit from another — plus a walk-in.
        await makeAppointment(null, svc._id, provider._id, { status: 'completed', totalPrice: 100, appointmentDate: inRangeDate(), guestName: 'Jane Guest', guestEmail: 'jane@guest.com' });
        await makeAppointment(null, svc._id, provider._id, { status: 'completed', totalPrice: 100, appointmentDate: inRangeDate(), guestName: 'Jane Guest', guestEmail: 'jane@guest.com' });
        await makeAppointment(null, svc._id, provider._id, { status: 'completed', totalPrice: 50, appointmentDate: inRangeDate(), guestName: 'Bob Guest', guestEmail: 'bob@guest.com' });
        await makeAppointment(null, svc._id, provider._id, { status: 'completed', totalPrice: 30, appointmentDate: inRangeDate(), walkInName: 'Counter Walk-in' });

        const res = await request(app)
            .get('/api/earnings')
            .set(authHeader(provider));

        expect(res.status).toBe(200);
        const clients = res.body.data.topClients;
        // Three distinct identities, not one collapsed "Walk-in" row.
        expect(clients).toHaveLength(3);
        const jane = clients.find(c => c.name === 'Jane Guest');
        expect(jane).toMatchObject({ earned: 200, count: 2 });
        expect(clients.find(c => c.name === 'Bob Guest')).toMatchObject({ earned: 50, count: 1 });
        expect(clients.find(c => c.name === 'Counter Walk-in')).toMatchObject({ earned: 30, count: 1 });

        // Recent list surfaces the guest's name rather than a generic "Walk-in".
        expect(res.body.data.recent.some(r => r.client === 'Jane Guest')).toBe(true);
    });
});
