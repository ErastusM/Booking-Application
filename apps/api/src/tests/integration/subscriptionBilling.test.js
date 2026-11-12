/**
 * Adding a card to start the Bookplus plan (SUBSCRIPTION_BILLING_ENABLED):
 * the first payment on PayGate's terminal 1 ("One time and tokenization"), which also saves the
 * card in PayGate's vault. The monthly payments, cancelling and replacing the
 * card are in subscriptionRenewals.test.js. PayGate is a fake transport; its vault wire format
 * is a made-up one (helpers/fakePaygate TEST_VAULT_WIRE) until PayHost's real
 * elements are filled in.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeFinanceAdmin, authHeader } = require('../helpers/factories');
const { createFakePaygate, PAYGATE_ID } = require('../helpers/fakePaygate');
const Subscription = require('../../models/Subscription');
const SubscriptionPayment = require('../../models/SubscriptionPayment');
const FinancialAuditLog = require('../../models/FinancialAuditLog');
const subs = require('../../services/subscriptions');
const billing = require('../../services/subscriptionBilling');
const { PLAN_TERMS_VERSION } = require('../../constants/consent');
const pricing = require('../../services/pricing');

const gw = createFakePaygate();

beforeAll(async () => {
    process.env.BUSINESS_ORIGIN = 'https://business.example.com';
    await testDb.connect();
});
beforeEach(() => {
    process.env.SUBSCRIPTION_BILLING_ENABLED = 'true';
    gw.install();
    gw.useVault();
});
afterEach(async () => {
    gw.uninstall();
    gw.reset();
    delete process.env.SUBSCRIPTION_BILLING_ENABLED;
    await testDb.clearDatabase();
    // The platform settings are cached; the next test starts from none.
    pricing.invalidateSettings();
});
afterAll(async () => {
    delete process.env.BUSINESS_ORIGIN;
    await testDb.closeDatabase();
});

const showPlans = async () => {
    const boss = await makeFinanceAdmin({ adminRoles: ['director'] });
    await request(app).put('/api/admin/finance/subscriptions/visibility').set(authHeader(boss)).send({ show: true, reason: 'Testing plans' }).expect(200);
};
/** A business on its free trial, plans shown to businesses. */
const trialOwner = async () => {
    await subs.startedAt(new Date(Date.now() - 1000));
    await showPlans();
    const owner = await makeProvider();
    await subs.forProvider(owner);
    return owner;
};
const startCheckout = (owner, body = { acceptTerms: true }) => request(app).post('/api/subscriptions/me/checkout').set(authHeader(owner)).send(body);
const notify = (body) => request(app).post('/api/subscriptions/paygate/notify').type('form').send(body);
const back = (body) => request(app).post('/api/subscriptions/paygate/return').type('form').send(body);

describe('behind the switch', () => {
    it('off (the default): never offered, and every card route is 404', async () => {
        delete process.env.SUBSCRIPTION_BILLING_ENABLED;
        const owner = await trialOwner();
        const me = await request(app).get('/api/subscriptions/me').set(authHeader(owner)).expect(200);
        expect(me.body.data).toMatchObject({ visible: true, status: 'trialing', canAddCard: false });
        expect((await startCheckout(owner)).status).toBe(404);
        expect((await request(app).get(`/api/subscriptions/me/checkout/BS${'0'.repeat(30)}`).set(authHeader(owner))).status).toBe(404);
        expect((await notify('PAY_REQUEST_ID=x&CHECKSUM=y')).status).toBe(404);
        expect((await back('PAY_REQUEST_ID=x&CHECKSUM=y')).status).toBe(404);
        expect(gw.calls).toHaveLength(0);
    });

    it('on, but plans not shown to businesses: not offered', async () => {
        await subs.startedAt(new Date(Date.now() - 1000));
        const owner = await makeProvider();
        expect((await startCheckout(owner)).status).toBe(404);
    });

    it('on, but the vault wire formats are not filled in (or a terminal not configured): unavailable', async () => {
        const owner = await trialOwner();
        gw.useVault(false);
        let me = await request(app).get('/api/subscriptions/me').set(authHeader(owner)).expect(200);
        expect(me.body.data.canAddCard).toBe(false);
        expect((await startCheckout(owner)).status).toBe(503);

        gw.useVault();
        delete process.env.PAYGATE_RECURRING_ID; // terminal 2, for the monthly payments
        expect((await startCheckout(owner)).status).toBe(503);
        process.env.PAYGATE_RECURRING_ID = '10011099999';
        delete process.env.PAYGATE_ID;
        expect((await startCheckout(owner)).status).toBe(503);
        expect(gw.calls).toHaveLength(0);
        me = await request(app).get('/api/subscriptions/me').set(authHeader(owner)).expect(200);
        expect(me.body.data.canAddCard).toBe(false);
    });
});

describe('add card and start plan', () => {
    it('opens a session on terminal 1 for the first month, asking to save the card', async () => {
        const owner = await trialOwner();
        const me = await request(app).get('/api/subscriptions/me').set(authHeader(owner)).expect(200);
        expect(me.body.data.canAddCard).toBe(true);

        const res = await startCheckout(owner);
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ amountCents: 6999, currency: 'NAD', method: 'POST', redirectUrl: expect.stringMatching(/^https:\/\//) });
        expect(Object.keys(res.body.data.fields)).toEqual(['PAYGATE_ID', 'PAY_REQUEST_ID', 'REFERENCE', 'CHECKSUM']);
        expect(res.body.data.reference).toMatch(billing.REFERENCE_RE);

        const sent = gw.calls[0].body;
        expect(sent).toContain(`<PayGateId>${PAYGATE_ID}</PayGateId>`);
        expect(sent).toMatch(/<\/Customer><TestSaveCard>true<\/TestSaveCard><Redirect>/);
        expect(sent).toContain('/api/subscriptions/paygate/notify');
        expect(sent).toContain('<Amount>6999</Amount>');

        const log = await FinancialAuditLog.find({ action: 'subscription.checkout_start' }).lean();
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ amountCents: 6999, reference: res.body.data.reference, actorRole: 'provider' });
    });

    it('refused unless the owner agrees to the plan terms: nothing is opened at PayGate', async () => {
        const owner = await trialOwner();
        for (const body of [{}, { acceptTerms: false }, { acceptTerms: 'true' }, { acceptTerms: 1 }]) {
            const res = await startCheckout(owner, body);
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('terms_required');
        }
        expect(gw.calls).toHaveLength(0);
        expect(await SubscriptionPayment.countDocuments({ provider: owner._id })).toBe(0);
        // (Showing plans to businesses wrote its own subscription.visibility entry.)
        expect(await FinancialAuditLog.countDocuments({ action: { $in: ['subscription.checkout_start', 'subscription.first_payment', 'subscription.payment_failed'] } })).toBe(0);
    });

    it('records which terms the owner agreed to, when, on the payment, the audit entries and the plan', async () => {
        const owner = await trialOwner();
        const { reference } = (await startCheckout(owner)).body.data;
        const payment = await SubscriptionPayment.findOne({ reference }).lean();
        expect(payment).toMatchObject({ termsVersion: PLAN_TERMS_VERSION, termsAcceptedAt: expect.any(Date) });
        expect(String(payment.termsAcceptedBy)).toBe(String(owner._id));
        const start = await FinancialAuditLog.findOne({ action: 'subscription.checkout_start' }).lean();
        expect(start.details).toMatchObject({ termsVersion: PLAN_TERMS_VERSION });

        gw.setStatus(reference, 1);
        await notify(gw.notifyBody(reference)).expect(200);
        const sub = await Subscription.findOne({ provider: owner._id }).lean();
        expect(sub.termsAccepted).toMatchObject({ version: PLAN_TERMS_VERSION, paymentRef: reference });
        expect(new Date(sub.termsAccepted.at).getTime()).toBe(new Date(payment.termsAcceptedAt).getTime());
        expect(String(sub.termsAccepted.by)).toBe(String(owner._id));
        const paid = await FinancialAuditLog.findOne({ action: 'subscription.first_payment' }).lean();
        expect(paid.details).toMatchObject({ termsVersion: PLAN_TERMS_VERSION });
    });

    it('approved: the notify starts the plan once, saves the card summary and the token; the return lands on Your plan', async () => {
        const owner = await trialOwner();
        const { reference } = (await startCheckout(owner)).body.data;
        gw.setStatus(reference, 1);

        expect((await notify(gw.notifyBody(reference))).text).toBe('OK');
        const sub = await Subscription.findOne({ provider: owner._id }).select('+vaultId').lean();
        expect(sub).toMatchObject({
            status: 'active', paidMonths: 1, lastPaymentRef: reference, vaultId: 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff',
            card: { brand: 'Visa', last4: '0002', expMonth: 12, expYear: 2030 },
        });
        // Adding a card early never shortens the trial: the paid month starts when it ends.
        expect(new Date(sub.paidThrough).getTime()).toBe(billing.addMonth(sub.trialEndsAt).getTime());
        expect(sub.history.map((h) => h.event)).toEqual(['trial_started', 'plan_started']);

        // The browser comes back afterwards: no second effect.
        const r = await back(gw.returnBody(reference));
        expect(r.status).toBe(303);
        expect(r.headers.location).toBe(`https://business.example.com/account?section=plan&checkout=${reference}`);
        const again = await Subscription.findOne({ provider: owner._id }).lean();
        expect(again.paidMonths).toBe(1);
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.first_payment' })).toBe(1);

        const payment = await SubscriptionPayment.findOne({ reference }).lean();
        expect(payment).toMatchObject({ status: 'paid', flagged: false, appliedAt: expect.any(Date) });
        expect(JSON.stringify(payment)).not.toContain('a1b2c3d4-e5f6');

        // The owner sees the card, never the token, and is not offered it again.
        const me = await request(app).get('/api/subscriptions/me').set(authHeader(owner)).expect(200);
        expect(me.body.data).toMatchObject({ status: 'active', canAddCard: false, card: { brand: 'Visa', last4: '0002', expMonth: 12, expYear: 2030 } });
        expect(JSON.stringify(me.body)).not.toContain('a1b2c3d4-e5f6');
        // What it can do now is replace the card (subscriptionRenewals.test.js).
        expect(me.body.data).toMatchObject({ canChangeCard: true, checkout: { kind: 'card' } });
    });

    it('a notify and a return racing apply the payment once', async () => {
        const owner = await trialOwner();
        const { reference } = (await startCheckout(owner)).body.data;
        gw.setStatus(reference, 1);
        await Promise.all([notify(gw.notifyBody(reference)), back(gw.returnBody(reference)), notify(gw.notifyBody(reference))]);
        const sub = await Subscription.findOne({ provider: owner._id }).lean();
        expect(sub.paidMonths).toBe(1);
        expect(sub.history.filter((h) => h.event === 'plan_started')).toHaveLength(1);
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.first_payment' })).toBe(1);
    });

    it('the owner\'s result view asks PayGate itself, so it never depends on a callback', async () => {
        const owner = await trialOwner();
        const { reference } = (await startCheckout(owner)).body.data;
        const status = () => request(app).get(`/api/subscriptions/me/checkout/${reference}`).set(authHeader(owner));
        expect((await status()).body.data).toMatchObject({ reference, status: 'initiated', amountCents: 6999 });
        gw.setStatus(reference, 1);
        await SubscriptionPayment.updateOne({ reference }, { $set: { lastQueriedAt: null } });
        expect((await status()).body.data.status).toBe('paid');
        expect((await Subscription.findOne({ provider: owner._id }).lean()).status).toBe('active');

        // Another business cannot see it.
        const other = await makeProvider();
        expect((await request(app).get(`/api/subscriptions/me/checkout/${reference}`).set(authHeader(other))).status).toBe(404);
    });

    it('declined: nothing starts, it is audited, and the owner can try again', async () => {
        const owner = await trialOwner();
        const { reference } = (await startCheckout(owner)).body.data;
        gw.setStatus(reference, 2);
        await notify(gw.notifyBody(reference)).expect(200);
        expect((await SubscriptionPayment.findOne({ reference }).lean()).status).toBe('failed');
        expect((await Subscription.findOne({ provider: owner._id }).lean()).status).toBe('trialing');
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.payment_failed' })).toBe(1);
        expect((await startCheckout(owner)).status).toBe(201);
    });

    it('approved for a different amount: flagged, the plan is not started', async () => {
        const owner = await trialOwner();
        const { reference } = (await startCheckout(owner)).body.data;
        gw.setStatus(reference, 1, { amountOverride: 100 });
        await notify(gw.notifyBody(reference)).expect(200);
        const p = await SubscriptionPayment.findOne({ reference }).lean();
        expect(p).toMatchObject({ status: 'initiated', flagged: true });
        expect((await Subscription.findOne({ provider: owner._id }).lean()).status).toBe('trialing');
    });

    it('approved but no card came back: the month is paid, flagged for Bookplus', async () => {
        const owner = await trialOwner();
        const { reference } = (await startCheckout(owner)).body.data;
        gw.setStatus(reference, 1, { noVault: true });
        await notify(gw.notifyBody(reference)).expect(200);
        const p = await SubscriptionPayment.findOne({ reference }).lean();
        expect(p).toMatchObject({ status: 'paid', flagged: true });
        const sub = await Subscription.findOne({ provider: owner._id }).select('+vaultId').lean();
        expect(sub).toMatchObject({ status: 'active', paidMonths: 1, vaultId: null });
        expect(sub.card?.last4 || null).toBeNull();
    });

    it('a business kept free has nothing to pay', async () => {
        const owner = await makeProvider();
        await subs.startedAt(new Date(Date.now() + 1000));
        await showPlans();
        const res = await startCheckout(owner);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('not_billable');
    });

    it('at most a few attempts a day', async () => {
        const owner = await trialOwner();
        for (let i = 0; i < billing.MAX_ATTEMPTS_PER_DAY; i += 1) await startCheckout(owner).expect(201);
        expect((await startCheckout(owner)).status).toBe(429);
    });

    it('PayGate unreachable: a clean error and the attempt is marked failed', async () => {
        const owner = await trialOwner();
        gw.initFail = true;
        expect((await startCheckout(owner)).status).toBe(502);
        expect((await SubscriptionPayment.findOne({ provider: owner._id }).lean()).status).toBe('failed');
    });
});

describe('callbacks are checked', () => {
    it('a notify with a bad checksum, or signed with another key, is refused and changes nothing', async () => {
        const owner = await trialOwner();
        const { reference } = (await startCheckout(owner)).body.data;
        gw.setStatus(reference, 1);
        expect((await notify(gw.notifyBody(reference, { tamper: true }))).status).toBe(400);
        expect((await notify(gw.notifyBody(reference, { checksumKey: 'another-key' }))).status).toBe(400);
        expect((await SubscriptionPayment.findOne({ reference }).lean()).status).toBe('initiated');
        expect((await Subscription.findOne({ provider: owner._id }).lean()).status).toBe('trialing');
    });

    it('a return with a bad checksum is not acted on, and still lands on our own page', async () => {
        const owner = await trialOwner();
        const { reference } = (await startCheckout(owner)).body.data;
        gw.setStatus(reference, 1);
        const r = await back(gw.returnBody(reference, { checksumKey: 'wrong' }));
        expect(r.status).toBe(303);
        expect(r.headers.location).toMatch(/^https:\/\/business\.example\.com\/account\?section=plan/);
        expect((await Subscription.findOne({ provider: owner._id }).lean()).status).toBe('trialing');
        // An unknown payment: still our page, never one from the request.
        const u = await back('PAY_REQUEST_ID=nope&TRANSACTION_STATUS=1&CHECKSUM=x');
        expect(u.headers.location).toBe('https://business.example.com/account?section=plan');
    });

    it('a notify keeps only known, non-sensitive fields', async () => {
        const owner = await trialOwner();
        const { reference } = (await startCheckout(owner)).body.data;
        gw.setStatus(reference, 1);
        await notify(gw.notifyBody(reference)).expect(200);
        const p = await SubscriptionPayment.findOne({ reference }).lean();
        expect(Object.keys(p.lastNotify)).not.toContain('CHECKSUM');
        expect(Object.keys(p.lastNotify)).not.toContain('RISK_INDICATOR');
        expect(p.lastNotify.REFERENCE).toBe(reference);
    });
});

describe('addMonth', () => {
    it('a month later, the 31st becoming the last day of a shorter month', () => {
        expect(billing.addMonth(new Date('2026-01-31T10:00:00Z')).toISOString()).toBe('2026-02-28T10:00:00.000Z');
        expect(billing.addMonth(new Date('2026-11-11T08:00:00Z')).toISOString()).toBe('2026-12-11T08:00:00.000Z');
        expect(billing.addMonth(new Date('2026-12-15T00:00:00Z')).toISOString()).toBe('2027-01-15T00:00:00.000Z');
    });
});
