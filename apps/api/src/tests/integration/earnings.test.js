/**
 * Earnings reporting integration tests.
 * Earnings reflect COMPLETED appointments only and are scoped per provider.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const {
    makeUser, makeProvider,
    makeService, makeAppointment,
    authHeader,
} = require('../helpers/factories');

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
});
