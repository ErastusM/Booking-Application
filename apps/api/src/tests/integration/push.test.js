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

const PushSubscription = require('../../models/PushSubscription');
const pushService = require('../../utils/pushService');

describe('Native device tokens (Ionic/Capacitor)', () => {
    it('stores an iOS device token as a native subscription (synthetic endpoint, no keys)', async () => {
        const user = await makeUser();
        const res = await request(app)
            .post('/api/push/subscribe')
            .set(authHeader(user))
            .send({ platform: 'ios', deviceToken: 'apns-token-123' });
        expect(res.status).toBe(201);

        const sub = await PushSubscription.findOne({ user: user._id });
        expect(sub.platform).toBe('ios');
        expect(sub.deviceToken).toBe('apns-token-123');
        expect(sub.endpoint).toBe('native:ios:apns-token-123');
        expect(sub.keys?.auth).toBeFalsy();
    });

    it('stores an Android device token', async () => {
        const user = await makeUser();
        const res = await request(app)
            .post('/api/push/subscribe')
            .set(authHeader(user))
            .send({ platform: 'android', deviceToken: 'fcm-token-xyz' });
        expect(res.status).toBe(201);
        const sub = await PushSubscription.findOne({ user: user._id, platform: 'android' });
        expect(sub.endpoint).toBe('native:android:fcm-token-xyz');
    });

    it('rejects a native subscription with no device token', async () => {
        const user = await makeUser();
        const res = await request(app)
            .post('/api/push/subscribe')
            .set(authHeader(user))
            .send({ platform: 'ios' });
        expect(res.status).toBe(400);
    });

    it('re-subscribing the same device token upserts (no duplicate row)', async () => {
        const user = await makeUser();
        const body = { platform: 'ios', deviceToken: 'dup-token' };
        await request(app).post('/api/push/subscribe').set(authHeader(user)).send(body);
        await request(app).post('/api/push/subscribe').set(authHeader(user)).send(body);
        const count = await PushSubscription.countDocuments({ endpoint: 'native:ios:dup-token' });
        expect(count).toBe(1);
    });

    it('web push targets only key-bearing rows, never native tokens', async () => {
        const user = await makeUser();
        await request(app).post('/api/push/subscribe').set(authHeader(user))
            .send({ endpoint: 'https://push.example/web1', keys: { p256dh: 'p', auth: 'a' } });
        await request(app).post('/api/push/subscribe').set(authHeader(user))
            .send({ platform: 'ios', deviceToken: 'native-1' });

        const webTargets = await PushSubscription.find({ user: user._id, 'keys.auth': { $exists: true } });
        expect(webTargets).toHaveLength(1);
        expect(webTargets[0].endpoint).toBe('https://push.example/web1');

        // sendToUser is a no-op in test (no VAPID) and must not throw with a native row present.
        await expect(pushService.sendToUser(user._id, { title: 't', body: 'b' })).resolves.toBeUndefined();
    });

    it('unsubscribes a native device token', async () => {
        const user = await makeUser();
        await request(app).post('/api/push/subscribe').set(authHeader(user))
            .send({ platform: 'android', deviceToken: 'gone-token' });
        const res = await request(app).post('/api/push/unsubscribe').set(authHeader(user))
            .send({ platform: 'android', deviceToken: 'gone-token' });
        expect(res.status).toBe(200);
        const count = await PushSubscription.countDocuments({ endpoint: 'native:android:gone-token' });
        expect(count).toBe(0);
    });
});
