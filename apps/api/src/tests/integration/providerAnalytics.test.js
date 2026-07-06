/**
 * Provider operational-analytics integration tests (non-financial).
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

describe('GET /api/analytics/provider', () => {
    it('returns operational metrics scoped to the provider', async () => {
        const customer = await makeUser();
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { price: 100 });

        const today = new Date(); // inside the default last-30-days range
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'completed', appointmentDate: today });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'no-show', appointmentDate: today });
        await makeAppointment(customer._id, svc._id, provider._id, { status: 'cancelled', appointmentDate: today });

        const res = await request(app)
            .get('/api/analytics/provider')
            .set(authHeader(provider));

        expect(res.status).toBe(200);
        expect(res.body.data.totals.total).toBe(3);
        expect(res.body.data.totals.completed).toBe(1);
        expect(res.body.data.totals.noShow).toBe(1);
        expect(res.body.data.rates.noShowRate).toBe(50); // 1 no-show / (1 completed + 1 no-show)
        expect(Array.isArray(res.body.data.peakHours)).toBe(true);
        expect(Array.isArray(res.body.data.peakDays)).toBe(true);
        expect(res.body.data.peakDays).toHaveLength(7);
    });

    it('rejects customers', async () => {
        const customer = await makeUser();
        const res = await request(app)
            .get('/api/analytics/provider')
            .set(authHeader(customer));
        expect(res.status).toBe(403);
    });
});
