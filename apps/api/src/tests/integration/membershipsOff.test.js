/**
 * Memberships / packages switched off (owner decision, September 2026, for the
 * payment provider's review): with MEMBERSHIPS_ENABLED off, every
 * /api/packages route answers 404 — nothing can be listed, created, bought or
 * redeemed — and existing records are left untouched.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const Package = require('../../models/Package');
const ClientPackage = require('../../models/ClientPackage');
const { makeProvider, makeUser, authHeader } = require('../helpers/factories');

beforeAll(async () => {
    process.env.MEMBERSHIPS_ENABLED = 'false';
    await testDb.connect();
});
afterAll(async () => {
    process.env.MEMBERSHIPS_ENABLED = 'true';
    await testDb.closeDatabase();
});
afterEach(() => testDb.clearDatabase());

describe('memberships switched off', () => {
    it('every packages route is a 404 for the business and the client, and nothing is written', async () => {
        const provider = await makeProvider();
        const client = await makeUser();
        const pkg = await Package.create({ provider: provider._id, name: 'Ten sessions', totalSessions: 10, price: 500 });

        const asOwner = [
            request(app).get('/api/packages/my-packages'),
            request(app).post('/api/packages/my-packages').send({ name: 'New', totalSessions: 5, price: 100 }),
            request(app).put(`/api/packages/my-packages/${pkg._id}`).send({ price: 1 }),
            request(app).delete(`/api/packages/my-packages/${pkg._id}`),
            request(app).get('/api/packages/my-package-clients'),
        ];
        for (const r of asOwner) {
            const res = await r.set(authHeader(provider));
            expect(res.status).toBe(404);
        }
        const asClient = [
            request(app).get(`/api/packages/provider/${provider._id}`),
            request(app).post(`/api/packages/${pkg._id}/purchase`),
            request(app).get('/api/packages/my-client-packages'),
        ];
        for (const r of asClient) {
            const res = await r.set(authHeader(client));
            expect(res.status).toBe(404);
        }
        // Not even a sign-in is needed to get the same answer.
        expect((await request(app).get(`/api/packages/provider/${provider._id}`)).status).toBe(404);

        expect(await Package.countDocuments()).toBe(1);
        expect((await Package.findById(pkg._id)).price).toBe(500);
        expect(await ClientPackage.countDocuments()).toBe(0);
    });
});
