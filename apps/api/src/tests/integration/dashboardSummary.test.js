/**
 * Perf P2 — dashboard windowing + all-time summary.
 *
 * The provider dashboard's calendar list is now date-windowed for speed (a
 * business with years of completed bookings no longer ships its whole archive to
 * the browser). To keep the Total / per-status / popular-services / clients-served
 * figures whole-history, they move to a dedicated aggregate:
 *
 *   A. GET /appointments/summary — all-time counters, role-scoped, ignoring any
 *      date window.
 *   B. GET /appointments?all=true&from=YYYY-MM-DD — the ADDITIVE window: `from`
 *      caps how far back the list reaches; without it, behaviour is unchanged.
 *
 * The two must never disagree on WHO a principal can see (same scoping helper).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeService, makeAppointment, authHeader } = require('../helpers/factories');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const daysFromNow = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
};
const ymd = (d) => {
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

describe('GET /appointments/summary — all-time counters', () => {
    it('counts every status regardless of date, scoped to the provider', async () => {
        const provider = await makeProvider();
        const cut = await makeService(provider._id, { name: 'Cut' });
        const colour = await makeService(provider._id, { name: 'Colour' });
        const alice = await makeUser();
        const bob = await makeUser();

        // Spread across the window boundary: some ancient, some future.
        await makeAppointment(alice._id, cut._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-300) });
        await makeAppointment(alice._id, cut._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-10) });
        await makeAppointment(bob._id, colour._id, provider._id, { status: 'confirmed', appointmentDate: daysFromNow(5) });
        await makeAppointment(bob._id, cut._id, provider._id, { status: 'pending', appointmentDate: daysFromNow(6) });
        await makeAppointment(alice._id, colour._id, provider._id, { status: 'cancelled', appointmentDate: daysFromNow(-2) });
        // A walk-in (no customer) and a guest (no customer, no walk-in name).
        await makeAppointment(null, cut._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-1), customer: null, walkInName: 'Cash Client' });
        await makeAppointment(null, cut._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-1), customer: null, guestName: 'Guest', guestEmail: 'g@test.com' });

        const res = await request(app).get('/api/appointments/summary').set(authHeader(provider));
        expect(res.status).toBe(200);
        const d = res.body.data;

        expect(d.total).toBe(7);
        expect(d.byStatus.completed).toBe(4);
        expect(d.byStatus.confirmed).toBe(1);
        expect(d.byStatus.pending).toBe(1);
        expect(d.byStatus.cancelled).toBe(1);

        // Popular services by booking count: Cut (5) ahead of Colour (2).
        expect(d.byService[0]).toEqual({ name: 'Cut', count: 5 });
        expect(d.byService.find((s) => s.name === 'Colour').count).toBe(2);

        // Distinct clients = alice + bob + the walk-in name. The guest-only
        // booking has no client identity and must NOT be counted.
        expect(d.uniqueClients).toBe(3);
    });

    it('never leaks another provider\'s bookings', async () => {
        const mine = await makeProvider();
        const other = await makeProvider();
        const svcMine = await makeService(mine._id);
        const svcOther = await makeService(other._id);
        const cust = await makeUser();
        await makeAppointment(cust._id, svcMine._id, mine._id, { status: 'completed' });
        await makeAppointment(cust._id, svcOther._id, other._id, { status: 'completed' });
        await makeAppointment(cust._id, svcOther._id, other._id, { status: 'pending' });

        const res = await request(app).get('/api/appointments/summary').set(authHeader(mine));
        expect(res.body.data.total).toBe(1);
        expect(res.body.data.byStatus.completed).toBe(1);
    });

    it('scopes a customer to their own bookings', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const me = await makeUser();
        const someoneElse = await makeUser();
        await makeAppointment(me._id, svc._id, provider._id, { status: 'completed' });
        await makeAppointment(someoneElse._id, svc._id, provider._id, { status: 'completed' });

        const res = await request(app).get('/api/appointments/summary').set(authHeader(me));
        expect(res.body.data.total).toBe(1);
        expect(res.body.data.uniqueClients).toBe(1);
    });
});

describe('GET /appointments — additive date window', () => {
    it('without `from`, still returns the whole history (unchanged behaviour)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const cust = await makeUser();
        await makeAppointment(cust._id, svc._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-300) });
        await makeAppointment(cust._id, svc._id, provider._id, { status: 'confirmed', appointmentDate: daysFromNow(5) });

        const res = await request(app).get('/api/appointments?all=true').set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
    });

    it('`from` excludes bookings before the floor but keeps everything after', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const cust = await makeUser();
        const ancient = await makeAppointment(cust._id, svc._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-300) });
        const recent = await makeAppointment(cust._id, svc._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-10) });
        const future = await makeAppointment(cust._id, svc._id, provider._id, { status: 'confirmed', appointmentDate: daysFromNow(30) });

        const from = ymd(daysFromNow(-120));
        const res = await request(app).get(`/api/appointments?all=true&from=${from}`).set(authHeader(provider));
        expect(res.status).toBe(200);
        const ids = res.body.data.map((a) => String(a._id));
        expect(ids).toContain(String(recent._id));
        expect(ids).toContain(String(future._id));
        expect(ids).not.toContain(String(ancient._id));
    });

    it('a malformed `from` is ignored (window is best-effort, never an error)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const cust = await makeUser();
        await makeAppointment(cust._id, svc._id, provider._id, { status: 'completed', appointmentDate: daysFromNow(-300) });
        await makeAppointment(cust._id, svc._id, provider._id, { status: 'confirmed', appointmentDate: daysFromNow(5) });

        const res = await request(app).get('/api/appointments?all=true&from=not-a-date').set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
    });
});
