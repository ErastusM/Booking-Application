/**
 * The monthly side of the Bookplus plan (SUBSCRIPTION_BILLING_ENABLED):
 * charging the saved card on terminal 2 ("NON3DS"), a payment that does not
 * go through (retries, then the plan paused: no new online bookings),
 * cancelling and keeping the plan, replacing the card, and deleting saved
 * cards at PayGate. PayGate is a fake transport with made-up wire formats
 * (helpers/fakePaygate) until PayHost's real elements are filled in.
 */
jest.mock('../../utils/alerts', () => ({ sendAlert: jest.fn().mockResolvedValue(true) }));

const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeFinanceAdmin, authHeader } = require('../helpers/factories');
const { createFakePaygate, RECURRING_ID } = require('../helpers/fakePaygate');
const Subscription = require('../../models/Subscription');
const SubscriptionPayment = require('../../models/SubscriptionPayment');
const VaultDeletion = require('../../models/VaultDeletion');
const FinancialAuditLog = require('../../models/FinancialAuditLog');
const Notification = require('../../models/Notification');
const User = require('../../models/User');
const subs = require('../../services/subscriptions');
const billing = require('../../services/subscriptionBilling');
const renewals = require('../../services/subscriptionRenewals');
const pricing = require('../../services/pricing');
const { providerBookingBlock, publicProviderIds, bookableProviderIds } = require('../../utils/publicProvider');
const { sendAlert } = require('../../utils/alerts');

const gw = createFakePaygate();
const DAY = 24 * 60 * 60 * 1000;
const FIRST_VAULT = 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff';
const NEW_VAULT = 'ffffeeee-dddd-4ccc-bbbb-aaaa99998888';

beforeAll(async () => {
    process.env.BUSINESS_ORIGIN = 'https://business.example.com';
    await testDb.connect();
});
beforeEach(() => {
    process.env.SUBSCRIPTION_BILLING_ENABLED = 'true';
    gw.install();
    gw.useVault();
    sendAlert.mockClear();
});
afterEach(async () => {
    gw.uninstall();
    gw.reset();
    delete process.env.SUBSCRIPTION_BILLING_ENABLED;
    await testDb.clearDatabase();
    pricing.invalidateSettings();
});
afterAll(async () => {
    delete process.env.BUSINESS_ORIGIN;
    await testDb.closeDatabase();
});

const showPlans = async () => {
    const boss = await makeFinanceAdmin({ adminRoles: ['director'] });
    await request(app).put('/api/admin/finance/subscriptions/visibility').set(authHeader(boss)).send({ show: true, reason: 'Testing plans' }).expect(200);
    return boss;
};
const startCheckout = (owner) => request(app).post('/api/subscriptions/me/checkout').set(authHeader(owner)).send({ acceptTerms: true });
const notify = (body) => request(app).post('/api/subscriptions/paygate/notify').type('form').send(body);
const me = async (owner) => (await request(app).get('/api/subscriptions/me').set(authHeader(owner)).expect(200)).body.data;
const sub = (owner) => Subscription.findOne({ provider: owner._id }).select('+vaultId').lean();
const at = (d, ms = 0) => new Date(new Date(d).getTime() + ms);

/** A business that added its card and paid its first month (paid to a month after its trial). */
const paidOwner = async () => {
    await subs.startedAt(new Date(Date.now() - 1000));
    const boss = await showPlans();
    const owner = await makeProvider();
    await subs.forProvider(owner);
    const { reference } = (await startCheckout(owner).expect(201)).body.data;
    gw.setStatus(reference, 1);
    await notify(gw.notifyBody(reference)).expect(200);
    const s = await sub(owner);
    expect(s).toMatchObject({ status: 'active', paidMonths: 1, vaultId: FIRST_VAULT });
    return { owner, boss, paidThrough: new Date(s.paidThrough) };
};

/** Pay with a new card through PayGate's page (kind "card"). */
const payWithNewCard = async (owner, { vaultId = NEW_VAULT, masked = '510000xxxxxx1111' } = {}) => {
    const res = await startCheckout(owner).expect(201);
    expect(res.body.data.kind).toBe('card');
    gw.setStatus(res.body.data.reference, 1, { vaultId, masked });
    await notify(gw.notifyBody(res.body.data.reference)).expect(200);
    return res.body.data;
};

describe('the monthly payment from the saved card', () => {
    it('is charged on terminal 2 when the paid month is up, once, and the plan runs another month', async () => {
        const { owner, paidThrough } = await paidOwner();
        // Not before the month is up.
        expect(await renewals.chargeDue(at(paidThrough, -60000))).toEqual({});
        expect(gw.charges()).toHaveLength(0);

        const now = at(paidThrough, 3600 * 1000);
        expect(await renewals.chargeDue(now)).toEqual({ charged: 1 });
        const sent = gw.charges();
        expect(sent).toHaveLength(1);
        expect(sent[0].body).toContain(`<PayGateId>${RECURRING_ID}</PayGateId>`);
        expect(sent[0].body).toContain(`<TestVaultId>${FIRST_VAULT}</TestVaultId>`);
        expect(sent[0].body).toContain('<Amount>6999</Amount>');

        const s = await sub(owner);
        expect(s).toMatchObject({ status: 'active', paidMonths: 2, chargingAt: null });
        expect(new Date(s.paidThrough).getTime()).toBe(billing.addMonth(paidThrough).getTime());
        const p = await SubscriptionPayment.findOne({ provider: owner._id, kind: 'renewal' }).lean();
        expect(p).toMatchObject({ status: 'paid', terminal: 'recurring', attempt: 1, amountCents: 6999, appliedAt: expect.any(Date) });
        expect(new Date(p.periodStart).getTime()).toBe(paidThrough.getTime());
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.renewal_start' })).toBe(1);
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.renewal_payment' })).toBe(1);
        expect(await Notification.countDocuments({ user: owner._id, message: /went through/ })).toBe(1);

        // The next tick, same hour: nothing more.
        expect(await renewals.chargeDue(now)).toEqual({});
        expect(gw.charges()).toHaveLength(1);
    });

    it('two ticks at once charge the card once', async () => {
        const { owner, paidThrough } = await paidOwner();
        const now = at(paidThrough, 1000);
        await Promise.all([renewals.chargeDue(now), renewals.chargeDue(now), renewals.chargeOne((await sub(owner))._id, now)]);
        expect(gw.charges()).toHaveLength(1);
        expect((await sub(owner)).paidMonths).toBe(2);
    });

    it('the introductory price ending: the owner is told 15 days ahead, then the standard price is charged', async () => {
        const { owner, paidThrough } = await paidOwner();
        await Subscription.updateOne({ provider: owner._id }, { $set: { paidMonths: 6 } });
        // Not yet: more than 15 days ahead.
        expect(await renewals.notifyPriceRises(at(paidThrough, -16 * DAY))).toBe(0);
        expect(await renewals.notifyPriceRises(at(paidThrough, -15 * DAY))).toBe(1);
        expect(await renewals.notifyPriceRises(at(paidThrough, -10 * DAY))).toBe(0); // once
        expect(await Notification.countDocuments({ user: owner._id, message: /introductory price ends/ })).toBe(1);
        await renewals.chargeDue(at(paidThrough, 1000));
        expect(gw.charges()[0].body).toContain('<Amount>14999</Amount>');
        expect((await sub(owner)).paidMonths).toBe(7);
    });

    it('a price rise not told 14 days ahead is not charged that month: the old price is', async () => {
        const { owner, paidThrough } = await paidOwner();
        await Subscription.updateOne({ provider: owner._id }, { $set: { paidMonths: 6 } });
        // Told too late (10 days ahead).
        await Subscription.updateOne({ provider: owner._id }, { $set: { 'priceNotice.forPaidThrough': paidThrough, 'priceNotice.sentAt': at(paidThrough, -10 * DAY) } });
        await renewals.chargeDue(at(paidThrough, 1000));
        expect(gw.charges()[0].body).toContain('<Amount>6999</Amount>');
        // The rise is still to come, so it is told before the next payment.
        const s1 = await sub(owner);
        expect(s1.lastPriceCents).toBe(6999);
        expect(await renewals.notifyPriceRises(at(s1.paidThrough, -15 * DAY))).toBe(1);
        await renewals.chargeDue(at(s1.paidThrough, 1000));
        expect(gw.charges()[1].body).toContain('<Amount>14999</Amount>');
    });

    it('no notice when the price stays the same', async () => {
        const { paidThrough } = await paidOwner();
        expect(await renewals.notifyPriceRises(at(paidThrough, -15 * DAY))).toBe(0);
    });

    it('still processing at PayGate: kept open, asked about on the next tick, applied once', async () => {
        const { owner, paidThrough } = await paidOwner();
        gw.chargeOutcome = 5;
        const now = at(paidThrough, 1000);
        expect(await renewals.chargeDue(now)).toEqual({ pending: 1 });
        const p = await SubscriptionPayment.findOne({ provider: owner._id, kind: 'renewal' }).lean();
        expect(p).toMatchObject({ status: 'pending', payRequestId: expect.any(String) });
        expect((await sub(owner)).status).toBe('active');

        gw.setStatus(p.reference, 1);
        expect(await renewals.chargeDue(at(now, 3600 * 1000))).toEqual({ charged: 1 });
        expect(gw.charges()).toHaveLength(1); // asked, not charged again
        expect((await sub(owner)).paidMonths).toBe(2);
    });

    it('PayGate unreachable mid-charge: the outcome is unknown, so it is flagged and never charged again blind', async () => {
        const { owner, paidThrough } = await paidOwner();
        gw.chargeOutcome = 'network';
        const now = at(paidThrough, 1000);
        expect(await renewals.chargeDue(now)).toEqual({ unknown: 1 });
        const p = await SubscriptionPayment.findOne({ provider: owner._id, kind: 'renewal' }).lean();
        expect(p).toMatchObject({ status: 'initiated', flagged: true, payRequestId: null });
        expect(sendAlert).toHaveBeenCalledWith('Plan renewal outcome unknown', expect.any(String));

        gw.chargeOutcome = 1;
        expect(await renewals.chargeDue(at(now, DAY))).toEqual({ unknown: 1 });
        expect(gw.charges()).toHaveLength(1);
        // And the owner cannot pay with a new card on top of it.
        expect((await startCheckout(owner)).body.code).toBe('busy');
    });

    it('no saved card (PayGate returned none with the first payment): a failed try, the plan is past due', async () => {
        const { owner, paidThrough } = await paidOwner();
        await Subscription.updateOne({ provider: owner._id }, { $set: { vaultId: null } });
        expect(await renewals.chargeDue(at(paidThrough, 1000))).toEqual({ declined: 1 });
        expect(gw.charges()).toHaveLength(0);
        expect((await sub(owner)).status).toBe('past_due');
    });

    it('switched off, or the wire formats not filled in: nothing is charged', async () => {
        const { paidThrough } = await paidOwner();
        delete process.env.SUBSCRIPTION_BILLING_ENABLED;
        await renewals.runBillingTick(at(paidThrough, 1000));
        process.env.SUBSCRIPTION_BILLING_ENABLED = 'true';
        gw.useVault(false);
        await renewals.runBillingTick(at(paidThrough, 1000));
        expect(gw.charges()).toHaveLength(0);
    });
});

describe('a payment that does not go through', () => {
    it('past due (still listed), tried again 1, 3 and 5 days later, then paused at 7 days: still listed, no new online bookings', async () => {
        const { owner, paidThrough } = await paidOwner();
        gw.chargeOutcome = 2;
        const t0 = at(paidThrough, 1000);
        expect(await renewals.chargeDue(t0)).toEqual({ declined: 1 });
        let s = await sub(owner);
        expect(s).toMatchObject({ status: 'past_due', retry: { attempts: 1 } });
        expect(new Date(s.retry.nextAttemptAt).getTime()).toBe(t0.getTime() + DAY);
        expect(new Date(s.retry.graceEndsAt).getTime()).toBe(t0.getTime() + 7 * DAY);
        expect(await Notification.countDocuments({ user: owner._id, message: /did not go through/ })).toBe(1);
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.payment_failed' })).toBe(1);
        expect(await providerBookingBlock(owner._id)).toBeNull();

        // Not tried again before its time.
        expect(await renewals.chargeDue(at(t0, DAY - 60000))).toEqual({});
        for (const [days, next] of [[1, 3], [3, 5], [5, null]]) {
            expect(await renewals.chargeDue(at(t0, days * DAY))).toEqual({ declined: 1 });
            s = await sub(owner);
            expect(s.status).toBe('past_due');
            expect(s.retry.nextAttemptAt ? new Date(s.retry.nextAttemptAt).getTime() : null).toBe(next ? t0.getTime() + next * DAY : null);
        }
        expect(gw.charges()).toHaveLength(4);
        expect(new Set((await SubscriptionPayment.find({ kind: 'renewal' }).lean()).map((p) => p.attempt))).toEqual(new Set([1, 2, 3, 4]));

        // Still unpaid 7 days after the first failure: paused.
        expect(await renewals.pauseOverdue(at(t0, 7 * DAY - 60000))).toBe(0);
        expect(await renewals.pauseOverdue(at(t0, 7 * DAY))).toBe(1);
        s = await sub(owner);
        expect(s).toMatchObject({ status: 'paused', pausedAt: expect.any(Date) });
        expect((await User.findById(owner._id).lean()).billingPausedAt).toEqual(expect.any(Date));
        // Still listed and visible, but clients cannot book it online; the business can still add bookings itself.
        const profile = await request(app).get(`/api/providers/${owner._id}`);
        expect(profile.status).toBe(200);
        expect(profile.body.data.provider.takingOnlineBookings).toBe(false);
        expect(await providerBookingBlock(owner._id)).toMatchObject({ status: 403, code: 'online_bookings_paused' });
        expect(await providerBookingBlock(owner._id, { byBusiness: true })).toBeNull();
        expect([...await publicProviderIds([owner._id])]).toEqual([String(owner._id)]);
        expect([...await bookableProviderIds([owner._id])]).toEqual([]);
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.paused' })).toBe(1);
        // Paused: the saved card is not tried again.
        expect(await renewals.chargeDue(at(t0, 8 * DAY))).toEqual({});
        expect((await me(owner)).status).toBe('paused');
    });

    it('a later try that goes through pays the overdue month and clears the retries', async () => {
        const { owner, paidThrough } = await paidOwner();
        gw.chargeOutcome = 2;
        const t0 = at(paidThrough, 1000);
        await renewals.chargeDue(t0);
        gw.chargeOutcome = 1;
        expect(await renewals.chargeDue(at(t0, DAY))).toEqual({ charged: 1 });
        const s = await sub(owner);
        expect(s).toMatchObject({ status: 'active', paidMonths: 2, retry: { attempts: 0, nextAttemptAt: null, graceEndsAt: null } });
        // The month paid is the overdue one: the plan is not shifted.
        expect(new Date(s.paidThrough).getTime()).toBe(billing.addMonth(paidThrough).getTime());
    });

    it('PayGate refuses the request (no transaction): counted as a failed try, the team told', async () => {
        const { owner, paidThrough } = await paidOwner();
        gw.chargeOutcome = 'error';
        expect(await renewals.chargeDue(at(paidThrough, 1000))).toEqual({ declined: 1 });
        expect((await sub(owner)).status).toBe('past_due');
        expect(sendAlert).toHaveBeenCalledWith('Plan renewal refused by PayGate', expect.any(String));
    });

    it('paused: paying with another card starts a new month today, shows the business again, and replaces the card', async () => {
        const { owner, paidThrough } = await paidOwner();
        gw.chargeOutcome = 2;
        const t0 = at(paidThrough, 1000);
        await renewals.chargeDue(t0);
        await Subscription.updateOne({ provider: owner._id }, { $set: { 'retry.graceEndsAt': new Date(Date.now() - 1000), 'retry.nextAttemptAt': null } });
        expect(await renewals.pauseOverdue(new Date())).toBe(1);

        const d = await me(owner);
        expect(d).toMatchObject({ status: 'paused', canAddCard: false, canChangeCard: true, checkout: { kind: 'card', amountCents: 6999 } });
        const before = Date.now();
        await payWithNewCard(owner);
        const s = await sub(owner);
        expect(s).toMatchObject({ status: 'active', paidMonths: 2, vaultId: NEW_VAULT, card: { last4: '1111' }, pausedAt: null });
        expect(new Date(s.paidThrough).getTime()).toBeGreaterThanOrEqual(billing.addMonth(new Date(before)).getTime() - 5000);
        expect((await User.findById(owner._id).lean()).billingPausedAt).toBeNull();
        expect(await providerBookingBlock(owner._id)).toBeNull();
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.card_payment' })).toBe(1);

        // The card it replaced is deleted at PayGate.
        expect(await VaultDeletion.countDocuments({ reason: 'card_replaced', status: 'pending' })).toBe(1);
        expect(await renewals.runVaultDeletions(new Date())).toBe(1);
        expect(gw.deleted).toEqual([FIRST_VAULT]);
        const del = await VaultDeletion.findOne({}).select('+vaultId').lean();
        expect(del).toMatchObject({ status: 'done', vaultId: null });
    });
});

describe('replacing the card', () => {
    it('pays the next month now with the new card, which replaces the saved one', async () => {
        const { owner, paidThrough } = await paidOwner();
        const d = await me(owner);
        expect(d).toMatchObject({ status: 'active', canChangeCard: true, checkout: { kind: 'card', amountCents: 6999 } });
        expect(new Date(d.checkout.paidThroughAfter).getTime()).toBe(billing.addMonth(paidThrough).getTime());

        await payWithNewCard(owner);
        const s = await sub(owner);
        expect(s).toMatchObject({ status: 'active', paidMonths: 2, vaultId: NEW_VAULT, card: { last4: '1111' } });
        expect(new Date(s.paidThrough).getTime()).toBe(billing.addMonth(paidThrough).getTime());
        expect(s.history.map((h) => h.event)).toContain('card_replaced');
        await renewals.runVaultDeletions(new Date());
        expect(gw.deleted).toEqual([FIRST_VAULT]);

        // The next monthly payment is a month later, on the new card.
        await renewals.chargeDue(at(s.paidThrough, 1000));
        expect(gw.charges()[0].body).toContain(`<TestVaultId>${NEW_VAULT}</TestVaultId>`);
    });

    it('a new card and the monthly payment never both pay the same month unnoticed', async () => {
        const { owner } = await paidOwner();
        // This test runs on the real clock: the paid month is up now.
        await Subscription.updateOne({ provider: owner._id }, { $set: { paidThrough: new Date(Date.now() - 1000) } });
        // The owner is on PayGate's page with a new card…
        const { reference } = (await startCheckout(owner).expect(201)).body.data;
        // …so the monthly payment waits for it.
        expect(await renewals.chargeDue(new Date())).toEqual({ card_session: 1 });
        expect(gw.charges()).toHaveLength(0);

        // If both are paid anyway (the session went stale first), the later one
        // is flagged for Bookplus, never applied as a second month.
        await SubscriptionPayment.collection.updateOne({ reference }, { $set: { createdAt: new Date(Date.now() - 2 * billing.CARD_SESSION_MS) } });
        expect(await renewals.chargeDue(new Date())).toEqual({ charged: 1 });
        gw.setStatus(reference, 1, { vaultId: NEW_VAULT });
        await notify(gw.notifyBody(reference)).expect(200);
        const late = await SubscriptionPayment.findOne({ reference }).lean();
        expect(late).toMatchObject({ status: 'paid', flagged: true, flagReason: expect.stringMatching(/not applied/) });
        expect(await sub(owner)).toMatchObject({ paidMonths: 2, vaultId: FIRST_VAULT });
        expect(sendAlert).toHaveBeenCalledWith('Plan payment not applied', expect.any(String));
    });

    it('not while the monthly payment is being taken', async () => {
        const { owner, paidThrough } = await paidOwner();
        gw.chargeOutcome = 5;
        await renewals.chargeDue(at(paidThrough, 1000));
        const res = await startCheckout(owner);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('busy');
    });
});

describe('cancelling and keeping the plan', () => {
    const cancel = (owner) => request(app).post('/api/subscriptions/me/cancel').set(authHeader(owner));
    const keep = (owner) => request(app).post('/api/subscriptions/me/keep').set(authHeader(owner));

    it('runs to the end of the paid month, charges nothing more, then ends and deletes the card', async () => {
        const { owner, paidThrough } = await paidOwner();
        expect((await me(owner)).canCancel).toBe(true);
        const r = await cancel(owner).expect(200);
        expect(new Date(r.body.data.endsAt).getTime()).toBe(paidThrough.getTime());
        expect(await me(owner)).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, nextPaymentAt: null, canCancel: false, canChangeCard: false });
        expect((await cancel(owner)).status).toBe(409);
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.cancel' })).toBe(1);

        const now = at(paidThrough, 1000);
        const out = await renewals.runBillingTick(now);
        expect(out).toMatchObject({ ended: 1, charges: {}, cardsDeleted: 1 });
        expect(gw.charges()).toHaveLength(0);
        const s = await sub(owner);
        expect(s).toMatchObject({ status: 'cancelled', vaultId: null, endedAt: expect.any(Date), card: { last4: null } });
        expect(gw.deleted).toEqual([FIRST_VAULT]);
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.ended' })).toBe(1);
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.card_deleted' })).toBe(1);
        // No plan: still listed, but no new online bookings until a plan is paid for again.
        expect(await providerBookingBlock(owner._id)).toMatchObject({ code: 'online_bookings_paused' });
        expect(await me(owner)).toMatchObject({ status: 'cancelled', onlineBookingsPaused: true, canAddCard: true, checkout: { kind: 'first' } });
    });

    it('kept before the paid month is over: the monthly payments carry on', async () => {
        const { owner, paidThrough } = await paidOwner();
        await cancel(owner).expect(200);
        await keep(owner).expect(200);
        expect(await me(owner)).toMatchObject({ cancelAtPeriodEnd: false, nextPaymentAt: paidThrough.toISOString() });
        expect((await keep(owner)).status).toBe(409);
        expect(await renewals.chargeDue(at(paidThrough, 1000))).toEqual({ charged: 1 });
    });

    it('cancelling with a month unpaid ends the plan at once; a paused business takes no online bookings until it pays', async () => {
        const { owner, paidThrough } = await paidOwner();
        gw.chargeOutcome = 2;
        await renewals.chargeDue(at(paidThrough, 1000));
        await Subscription.updateOne({ provider: owner._id }, { $set: { 'retry.graceEndsAt': new Date(Date.now() - 1000), 'retry.nextAttemptAt': null } });
        await renewals.pauseOverdue(new Date());
        const r = await cancel(owner).expect(200);
        expect(r.body.data).toMatchObject({ ended: true });
        expect((await sub(owner)).status).toBe('cancelled');
        expect(await providerBookingBlock(owner._id)).toMatchObject({ code: 'online_bookings_paused' });

        // Starting a new plan switches online bookings back on.
        const { reference } = (await startCheckout(owner).expect(201)).body.data;
        gw.setStatus(reference, 1, { vaultId: NEW_VAULT });
        await notify(gw.notifyBody(reference)).expect(200);
        expect(await sub(owner)).toMatchObject({ status: 'active', vaultId: NEW_VAULT });
        expect(await providerBookingBlock(owner._id)).toBeNull();
    });

    it('nothing to cancel on a trial; every route is 404 while switched off', async () => {
        await subs.startedAt(new Date(Date.now() - 1000));
        await showPlans();
        const owner = await makeProvider();
        await subs.forProvider(owner);
        expect((await cancel(owner)).status).toBe(409);
        delete process.env.SUBSCRIPTION_BILLING_ENABLED;
        expect((await cancel(owner)).status).toBe(404);
        expect((await keep(owner)).status).toBe(404);
        expect((await request(app).get('/api/subscriptions/me/payments').set(authHeader(owner))).status).toBe(404);
    });
});

describe('the free trial ending', () => {
    /** A business on its trial, ending `days` from now. */
    const onTrial = async (days) => {
        await subs.startedAt(new Date(Date.now() - 1000));
        await showPlans();
        const owner = await makeProvider();
        await subs.forProvider(owner);
        await Subscription.updateOne({ provider: owner._id }, { $set: { trialEndsAt: new Date(Date.now() + days * DAY) } });
        return owner;
    };

    it('reminds the owner 7 days and 1 day before, once each', async () => {
        const owner = await onTrial(10);
        expect(await renewals.remindTrialsEnding(new Date())).toBe(0);
        expect(await renewals.remindTrialsEnding(at(new Date(), 3 * DAY + 60000))).toBe(1);
        expect(await renewals.remindTrialsEnding(at(new Date(), 4 * DAY))).toBe(0);
        expect(await renewals.remindTrialsEnding(at(new Date(), 9 * DAY + 60000))).toBe(1);
        expect(await renewals.remindTrialsEnding(at(new Date(), 9 * DAY + 120000))).toBe(0);
        const notes = await Notification.find({ user: owner._id, message: /free trial ends on/ }).lean();
        expect(notes).toHaveLength(2);
    });

    it('ended with no month paid: no new online bookings until the first month is paid, then back on', async () => {
        const owner = await onTrial(1);
        expect(await renewals.pauseEndedTrials(new Date())).toBe(0); // not ended yet
        const after = at(new Date(), DAY + 60000);
        expect(await renewals.pauseEndedTrials(after)).toBe(1);
        expect(await renewals.pauseEndedTrials(after)).toBe(0); // once
        expect(await sub(owner)).toMatchObject({ status: 'trial_ended', pausedAt: expect.any(Date) });
        expect(await providerBookingBlock(owner._id)).toMatchObject({ code: 'online_bookings_paused' });
        expect(await providerBookingBlock(owner._id, { byBusiness: true })).toBeNull();
        expect((await request(app).get(`/api/providers/${owner._id}`)).status).toBe(200);
        expect(await me(owner)).toMatchObject({ status: 'trial_ended', onlineBookingsPaused: true, canAddCard: true });
        expect(await FinancialAuditLog.countDocuments({ action: 'subscription.trial_ended_paused' })).toBe(1);
        expect(await Notification.countDocuments({ user: owner._id, message: /free trial has ended/ })).toBe(1);

        const { reference } = (await startCheckout(owner).expect(201)).body.data;
        gw.setStatus(reference, 1);
        await notify(gw.notifyBody(reference)).expect(200);
        expect(await sub(owner)).toMatchObject({ status: 'active', pausedAt: null });
        expect(await providerBookingBlock(owner._id)).toBeNull();
    });

    it('a card added during the trial: nothing is paused when it ends', async () => {
        const { owner } = await paidOwner();
        await Subscription.updateOne({ provider: owner._id }, { $set: { trialEndsAt: new Date(Date.now() - 1000) } });
        expect(await renewals.pauseEndedTrials(new Date())).toBe(0);
        expect(await providerBookingBlock(owner._id)).toBeNull();
    });

    it('switched off: the job does nothing to trials', async () => {
        const owner = await onTrial(-1);
        delete process.env.SUBSCRIPTION_BILLING_ENABLED;
        await renewals.runBillingTick(new Date());
        expect((await sub(owner)).pausedAt).toBeNull();
        expect(await providerBookingBlock(owner._id)).toBeNull();
    });
});

describe('the plan ending for other reasons', () => {
    it('closing the account ends the plan and deletes the card', async () => {
        const { owner } = await paidOwner();
        expect(await renewals.onAccountClosed(owner._id)).toBe(true);
        expect((await sub(owner)).status).toBe('cancelled');
        expect(await VaultDeletion.countDocuments({ reason: 'account_closed' })).toBe(1);
        await renewals.runVaultDeletions(new Date());
        expect(gw.deleted).toEqual([FIRST_VAULT]);
    });

    it('a director keeping a paused business free shows it again and deletes its card', async () => {
        const { owner, boss, paidThrough } = await paidOwner();
        gw.chargeOutcome = 2;
        await renewals.chargeDue(at(paidThrough, 1000));
        await Subscription.updateOne({ provider: owner._id }, { $set: { 'retry.graceEndsAt': new Date(Date.now() - 1000), 'retry.nextAttemptAt': null } });
        await renewals.pauseOverdue(new Date());
        await request(app).post(`/api/admin/finance/subscriptions/${owner._id}/keep-free`).set(authHeader(boss)).send({ reason: 'Pilot partner' }).expect(200);
        expect(await sub(owner)).toMatchObject({ status: 'exempt', vaultId: null });
        expect(await providerBookingBlock(owner._id)).toBeNull();
        expect(await VaultDeletion.countDocuments({ reason: 'plan_ended' })).toBe(1);
    });

    it('a card PayGate cannot delete yet is tried again later, then the team is told', async () => {
        const { owner } = await paidOwner();
        await renewals.onAccountClosed(owner._id);
        gw.deleteFail = true;
        expect(await renewals.runVaultDeletions(new Date())).toBe(0);
        let d = await VaultDeletion.findOne({}).lean();
        expect(d).toMatchObject({ status: 'pending', attempts: 1 });
        expect(new Date(d.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
        await VaultDeletion.updateOne({}, { $set: { attempts: 9, nextAttemptAt: new Date(0) } });
        await renewals.runVaultDeletions(new Date());
        d = await VaultDeletion.findOne({}).lean();
        expect(d.status).toBe('failed');
        expect(sendAlert).toHaveBeenCalledWith('Saved card not deleted at PayGate', expect.any(String));
    });
});

describe('the owner\'s payments', () => {
    it('lists the paid plan payments, newest first, never a token', async () => {
        const { owner, paidThrough } = await paidOwner();
        await renewals.chargeDue(at(paidThrough, 1000));
        const res = await request(app).get('/api/subscriptions/me/payments').set(authHeader(owner)).expect(200);
        expect(res.body.data.map((p) => p.kind)).toEqual(['renewal', 'first']);
        expect(res.body.data[0]).toMatchObject({ amountCents: 6999, currency: 'NAD', reference: expect.stringMatching(billing.REFERENCE_RE) });
        expect(JSON.stringify(res.body)).not.toContain(FIRST_VAULT);
    });
});
