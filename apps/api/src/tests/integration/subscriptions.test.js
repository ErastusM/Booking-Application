/**
 * Business subscriptions, first step (no billing): businesses from before
 * subscriptions started are kept free; new ones start the Basic plan's free
 * trial at sign-up, with its prices snapshotted. A director can move a
 * business and show plans to businesses; every change is audited.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeFinanceAdmin, authHeader } = require('../helpers/factories');
const Subscription = require('../../models/Subscription');
const FinancialAuditLog = require('../../models/FinancialAuditLog');
const subs = require('../../services/subscriptions');
const { migrateSubscriptions } = require('../../../scripts/migrate_subscriptions');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

const DAY = 24 * 60 * 60 * 1000;
const director = () => makeFinanceAdmin({ adminRoles: ['director'] });
const financeOnly = () => makeFinanceAdmin({ adminRoles: ['finance'] });

describe('who is kept free and who is on a trial', () => {
    it('a business from before subscriptions started is kept free', async () => {
        const old = await makeProvider();
        const since = await subs.startedAt(new Date(Date.now() + 1000));
        expect(since).toBeInstanceOf(Date);
        // Set once: asking again does not move it.
        expect((await subs.startedAt(new Date(Date.now() + 60 * DAY))).getTime()).toBe(since.getTime());
        expect((await subs.forProvider(old)).status).toBe('exempt');
    });

    it('a business that signs up after starts the 30-day trial then, at the plan\'s prices', async () => {
        await subs.startedAt(new Date(Date.now() - 1000));
        const fresh = await makeProvider();
        const sub = await subs.forProvider(fresh);
        expect(sub).toMatchObject({
            status: 'trialing',
            terms: { trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999 },
        });
        expect(new Date(sub.trialEndsAt).getTime()).toBe(new Date(fresh.createdAt).getTime() + 30 * DAY);
        // One record per business.
        await subs.forProvider(fresh);
        expect(await Subscription.countDocuments({ provider: fresh._id })).toBe(1);
    });

    it('the deploy step keeps every existing business free and is safe to run again', async () => {
        await makeProvider();
        await makeProvider();
        const first = await migrateSubscriptions(new Date(Date.now() + 1000));
        expect(first).toMatchObject({ keptFree: 2, trials: 0, existing: 0 });
        const again = await migrateSubscriptions(new Date(Date.now() + 2000));
        expect(again).toMatchObject({ keptFree: 0, trials: 0, existing: 2 });
        expect(again.since.getTime()).toBe(first.since.getTime());
    });
});

describe('GET /api/subscriptions/me', () => {
    it('hidden until plans are shown to businesses, then the owner sees their plan', async () => {
        await subs.startedAt(new Date(Date.now() - 1000));
        const owner = await makeProvider();
        expect((await request(app).get('/api/subscriptions/me').set(authHeader(owner)).expect(200)).body.data).toEqual({ visible: false });

        const boss = await director();
        await request(app).put('/api/admin/finance/subscriptions/visibility').set(authHeader(boss)).send({ show: true, reason: 'Testing plans' }).expect(200);
        const res = await request(app).get('/api/subscriptions/me').set(authHeader(owner)).expect(200);
        expect(res.body.data).toMatchObject({ visible: true, status: 'trialing', trialDaysLeft: 30, nextPriceCents: 6999 });
    });

    it('is only for business owners', async () => {
        expect((await request(app).get('/api/subscriptions/me').set(authHeader(await makeUser()))).status).toBe(403);
        expect((await request(app).get('/api/subscriptions/me')).status).toBe(401);
    });
});

describe('admin: Money → Subscriptions', () => {
    it('lists every business with its status and counts', async () => {
        const old = await makeProvider();
        await subs.startedAt(new Date(Date.now() + 1000));
        const res = await request(app).get('/api/admin/finance/subscriptions').set(authHeader(await financeOnly())).expect(200);
        expect(res.body.data.counts).toEqual({ exempt: 1 });
        expect(res.body.data.rows[0]).toMatchObject({ status: 'exempt', provider: { _id: String(old._id), email: old.email } });
        expect(res.body.data.showToBusinesses).toBe(false);
    });

    it('a director starts a free trial or keeps a business free, with a reason; each change is audited', async () => {
        const biz = await makeProvider();
        await subs.startedAt(new Date(Date.now() + 1000));
        const boss = await director();
        const move = (kind, body) => request(app).post(`/api/admin/finance/subscriptions/${biz._id}/${kind}`).set(authHeader(boss)).send(body);

        expect((await move('trial', {})).status).toBe(400); // no reason
        const t = await move('trial', { reason: 'Pilot business' });
        expect(t.status).toBe(200);
        expect(t.body.data).toMatchObject({ status: 'trialing', trialDaysLeft: 30 });
        expect((await move('trial', { reason: 'again' })).status).toBe(409);

        const k = await move('keep-free', { reason: 'Partner' });
        expect(k.status).toBe(200);
        expect(k.body.data.status).toBe('exempt');

        const log = await FinancialAuditLog.find({ action: /^subscription\./ }).sort({ createdAt: 1, _id: 1 }).lean();
        expect(log.map((l) => [l.action, l.reason])).toEqual([['subscription.trial_start', 'Pilot business'], ['subscription.keep_free', 'Partner']]);
        const sub = await Subscription.findOne({ provider: biz._id }).lean();
        expect(sub.history.map((h) => h.event)).toEqual(['kept_free', 'trial_started', 'kept_free']);
    });

    it('finance can look but not change; unknown businesses are 404', async () => {
        const biz = await makeProvider();
        const fin = await financeOnly();
        expect((await request(app).post(`/api/admin/finance/subscriptions/${biz._id}/trial`).set(authHeader(fin)).send({ reason: 'x' })).status).toBe(403);
        expect((await request(app).put('/api/admin/finance/subscriptions/visibility').set(authHeader(fin)).send({ show: true, reason: 'x' })).status).toBe(403);
        const boss = await director();
        expect((await request(app).post('/api/admin/finance/subscriptions/0123456789abcdef01234567/trial').set(authHeader(boss)).send({ reason: 'x' })).status).toBe(404);
        expect((await request(app).post('/api/admin/finance/subscriptions/not-an-id/trial').set(authHeader(boss)).send({ reason: 'x' })).status).toBe(404);
    });
});
