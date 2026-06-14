/**
 * Web Push integration tests. Push is mocked/disabled by default
 * (no VAPID env vars in the test environment).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('Web Push', () => {
    it('reports push disabled when VAPID keys are absent', async () => {
        const res = await request(app).get('/api/push/vapid-public-key');
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(false);
    });

    it('stores a subscription for an authenticated user', async () => {
        const user = await makeUser();
        const res = await request(app)
            .post('/api/push/subscribe')
            .set(authHeader(user))
            .send({ endpoint: 'https://example.com/ep1', keys: { p256dh: 'abc', auth: 'def' } });
        expect(res.status).toBe(201);
    });

    it('rejects an invalid subscription', async () => {
        const user = await makeUser();
        const res = await request(app)
            .post('/api/push/subscribe')
            .set(authHeader(user))
            .send({ endpoint: 'https://example.com/ep2' }); // missing keys
        expect(res.status).toBe(400);
    });

    it('requires auth to subscribe', async () => {
        const res = await request(app)
            .post('/api/push/subscribe')
            .send({ endpoint: 'x', keys: { p256dh: 'a', auth: 'b' } });
        expect(res.status).toBe(401);
    });
});
