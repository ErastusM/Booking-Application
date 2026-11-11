/**
 * After a signing key leaked, the notification subscriptions stored before the
 * restart with the new key are removed (docs/ROTATING_SECRETS.md): one made
 * with a forged session would otherwise keep sending that account's
 * notifications to someone else's device. Anything stored after the restart
 * came from a real session and stays. The apps ask /api/push/status, so a
 * device the server forgot shows notifications as off.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, authHeader } = require('../helpers/factories');
const PushSubscription = require('../../models/PushSubscription');
const { clearPushSubscriptions } = require('../../../scripts/clear_push_subscriptions');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

const sub = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: `p256-${n}`, auth: `auth-${n}` } });

describe('clear_push_subscriptions.js', () => {
    it('removes what was stored before the restart and keeps what was stored since', async () => {
        const owner = await makeUser();
        const other = await makeUser();
        const old = new Date(Date.now() - 60 * 60 * 1000);
        // Stored before the restart: the owner's phone, and a device someone pointed at this account.
        await PushSubscription.collection.insertMany([
            { user: owner._id, ...sub(1), createdAt: old, updatedAt: old },
            { user: owner._id, ...sub(2), createdAt: old, updatedAt: old },
            { user: other._id, ...sub(3), createdAt: old, updatedAt: old },
        ]);
        const restart = new Date(Date.now() - 1000);
        // Someone turned notifications on again after the restart, before the clean-up ran.
        await request(app).post('/api/push/subscribe').set(authHeader(other)).send(sub(3)).expect(201);

        expect(await clearPushSubscriptions(restart)).toBe(2);
        expect(await PushSubscription.find().distinct('endpoint')).toEqual([sub(3).endpoint]);
    });
});

describe('POST /api/push/status', () => {
    it('says whether this device is stored for the signed-in account', async () => {
        const a = await makeUser();
        const b = await makeUser();
        await request(app).post('/api/push/subscribe').set(authHeader(a)).send(sub(1)).expect(201);
        const ask = (u) => request(app).post('/api/push/status').set(authHeader(u)).send({ endpoint: sub(1).endpoint });
        expect((await ask(a)).body).toMatchObject({ success: true, registered: true });
        // The same phone, someone else signed in: off for them, so they can choose to turn it on.
        expect((await ask(b)).body).toMatchObject({ success: true, registered: false });
        expect((await request(app).post('/api/push/status').set(authHeader(a)).send({})).status).toBe(400);
        expect((await request(app).post('/api/push/status').send({ endpoint: sub(1).endpoint })).status).toBe(401);
    });
});
