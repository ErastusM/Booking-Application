/**
 * Permission tiers — Phase 3a: the High tier opens READ-ONLY reports + wallet
 * views to a manager, each scoped to the employer via the businessScope remap:
 *   reports:view  → GET /api/retention, /api/earnings, /api/analytics/provider
 *   wallet:view   → GET /api/wallet/provider/*, /api/provider-wallet/me
 *
 * Guarantees under test: a High staff member reaches the views (200); a Medium
 * staff member (lacking reports:view/wallet:view) is refused at the route (403);
 * the owner is unchanged; and money-MOVEMENT routes are NOT opened to staff.
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

let seq = 0;
const makeStaff = async (provider, tier) => {
    seq += 1;
    const login = await makeUser({ role: 'staff', staffOf: provider._id, email: `staff-${tier}-${seq}@test.com`, staffTier: tier });
    await TeamMember.create({ provider: provider._id, name: `Staff ${tier} ${seq}`, role: 'Manager', user: login._id });
    return login;
};

// A business with some completed history so the reports have data to scope.
const makeBusiness = async () => {
    const provider = await makeProvider();
    const customer = await makeUser();
    const service = await makeService(provider._id);
    await makeAppointment(customer._id, service._id, provider._id, { status: 'completed', totalPrice: 100 });
    return { provider, customer, service };
};

const READ_ENDPOINTS = [
    '/api/retention',
    '/api/earnings',
    '/api/analytics/provider',
    '/api/wallet/provider/summary',
    '/api/wallet/provider/transactions',
    '/api/provider-wallet/me',
];

describe('reports:view / wallet:view — High tier read-only views', () => {
    it('a High staff member reaches every reports/wallet view (scoped to the employer)', async () => {
        const { provider } = await makeBusiness();
        const high = await makeStaff(provider, 'high');
        for (const url of READ_ENDPOINTS) {
            const res = await request(app).get(url).set(authHeader(high));
            expect([200, 304]).toContain(res.status); // 200 with (possibly empty) scoped data
        }
    });

    it('a Medium staff member is refused at every one (no reports:view/wallet:view)', async () => {
        const { provider } = await makeBusiness();
        const medium = await makeStaff(provider, 'medium');
        for (const url of READ_ENDPOINTS) {
            const res = await request(app).get(url).set(authHeader(medium));
            expect(res.status).toBe(403);
        }
    });

    it('the owner still reaches them (unchanged)', async () => {
        const { provider } = await makeBusiness();
        for (const url of READ_ENDPOINTS) {
            const res = await request(app).get(url).set(authHeader(provider));
            expect([200, 304]).toContain(res.status);
        }
    });

    it('a detached staff account (no staffOf) is refused', async () => {
        const { provider } = await makeBusiness();
        const high = await makeStaff(provider, 'high');
        // Sever the employer link, keep the tier.
        const User = require('../../models/User');
        await User.updateOne({ _id: high._id }, { $set: { staffOf: null } });
        const detached = await User.findById(high._id);
        const res = await request(app).get('/api/retention').set(authHeader(detached));
        expect(res.status).toBe(403);
    });
});

describe('money-movement stays closed to staff', () => {
    it('a High staff member cannot create a wallet adjustment (movement route not opened)', async () => {
        const { provider } = await makeBusiness();
        const high = await makeStaff(provider, 'high');
        const res = await request(app)
            .post('/api/wallet/provider/adjustments')
            .set(authHeader(high))
            .send({ customerId: provider._id.toString(), amount: 50, type: 'adjustment' });
        expect(res.status).toBe(403);
    });

    it('platform + admin analytics stay admin-only for a High staff member', async () => {
        const { provider } = await makeBusiness();
        const high = await makeStaff(provider, 'high');
        for (const url of ['/api/analytics', '/api/analytics/admin/providers']) {
            const res = await request(app).get(url).set(authHeader(high));
            expect(res.status).toBe(403);
        }
    });
});
