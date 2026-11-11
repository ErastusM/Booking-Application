/**
 * Business subscriptions (services/subscriptions.js). No money moves yet:
 * this shows who is kept free or in a trial, and lets a director move a
 * business. Every change is written to the audit log.
 */
const pino = require('pino');
const subs = require('../services/subscriptions');
const billing = require('../services/subscriptionBilling');
const paygate = require('../services/paygate');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const { subscriptionBillingEnabled } = require('../constants/features');
const pricing = require('../services/pricing');
const PlatformSettings = require('../models/PlatformSettings');
const { recordFinance } = require('../utils/financeAudit');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
const reasonOf = (req) => String(req.body?.reason || '').trim().slice(0, 500);

// GET /api/subscriptions/me (business owner). Hidden until the owner of
// Bookplus shows plans to businesses.
exports.mine = async (req, res) => {
    try {
        const settings = await pricing.getSettings();
        if (!settings.subscriptions?.showToBusinesses) return res.json({ success: true, data: { visible: false } });
        const sub = await subs.forProvider(req.user);
        const e = await billing.eligibility(sub);
        res.json({ success: true, data: { visible: true, ...subs.describe(sub), canAddCard: e.ok } });
    } catch {
        fail(res, 500, 'Internal server error');
    }
};

// GET /api/admin/finance/subscriptions
exports.list = async (req, res) => {
    try {
        const settings = await pricing.getSettings();
        const rows = await subs.listAll();
        const counts = rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
        // Can businesses add a card (and pay the first month) right now?
        const cardsOn = subscriptionBillingEnabled() && paygate.isConfigured(billing.TERMINAL) && paygate.vaultReady();
        res.json({ success: true, data: { rows, counts, showToBusinesses: !!settings.subscriptions?.showToBusinesses, startedAt: settings.subscriptions?.startedAt || null, cardsOn } });
    } catch {
        fail(res, 500, 'Internal server error');
    }
};

const MOVES = {
    trial: { run: subs.startTrial, action: 'subscription.trial_start', errors: { not_exempt: 'This business is not kept free, so it is already on a trial or a plan.' } },
    'keep-free': { run: subs.keepFree, action: 'subscription.keep_free', errors: { already_exempt: 'This business is already kept free.' } },
};

// POST /api/admin/finance/subscriptions/:id/trial | /keep-free { reason } (director)
exports.move = (kind) => async (req, res) => {
    const reason = reasonOf(req);
    if (!reason) return fail(res, 400, 'Give a reason; it goes in the audit log.');
    const m = MOVES[kind];
    try {
        const r = await m.run(req.params.id, { by: req.user._id, note: reason });
        if (!r.ok) {
            if (r.code === 'not_found') return fail(res, 404, 'Business not found.');
            return fail(res, 409, m.errors[r.code] || 'Not possible.', r.code);
        }
        await recordFinance({ actor: req.user, action: m.action, provider: req.params.id, reason, details: { status: r.subscription.status } });
        res.json({ success: true, data: r.subscription });
    } catch (err) {
        if (err?.name === 'CastError') return fail(res, 404, 'Business not found.');
        fail(res, 500, 'Internal server error');
    }
};

// PUT /api/admin/finance/subscriptions/visibility { show, reason } (director)
exports.setVisibility = async (req, res) => {
    const reason = reasonOf(req);
    if (typeof req.body?.show !== 'boolean') return fail(res, 400, 'Say whether to show plans to businesses.');
    if (!reason) return fail(res, 400, 'Give a reason; it goes in the audit log.');
    try {
        await pricing.getSettings(); // make sure the document exists
        await recordFinance({ actor: req.user, action: 'subscription.visibility', reason, details: { show: req.body.show } });
        await PlatformSettings.updateOne({ key: 'platform' }, { $set: { 'subscriptions.showToBusinesses': req.body.show } });
        pricing.invalidateSettings();
        res.json({ success: true, data: { showToBusinesses: req.body.show } });
    } catch {
        fail(res, 500, 'Internal server error');
    }
};

/* ───────────── Add card and start plan (SUBSCRIPTION_BILLING_ENABLED) ───────────── */

// POST /api/subscriptions/me/checkout (business owner) → where to send the
// browser: PayGate's hosted page, by a form POST of `fields`.
exports.startCheckout = async (req, res) => {
    try {
        const data = await billing.startCheckout(req.user, { acceptTerms: req.body?.acceptTerms === true });
        res.set('Cache-Control', 'no-store');
        res.status(201).json({ success: true, data });
    } catch (err) {
        if (err instanceof billing.CheckoutError) return fail(res, err.status, err.message, err.code);
        logger.error({ err: err.message }, 'Starting a plan checkout failed');
        fail(res, 500, 'Internal server error');
    }
};

// GET /api/subscriptions/me/checkout/:reference (business owner, their own only)
exports.checkoutStatus = async (req, res) => {
    try {
        const ref = String(req.params.reference || '');
        if (!billing.REFERENCE_RE.test(ref)) return fail(res, 404, 'Payment not found');
        let payment = await SubscriptionPayment.findOne({ reference: ref, provider: req.user._id });
        if (!payment) return fail(res, 404, 'Payment not found');
        // Still open: ask PayGate (throttled), so the result never depends on
        // a callback having arrived.
        if (SubscriptionPayment.OPEN.includes(payment.status) && payment.payRequestId
            && (!payment.lastQueriedAt || Date.now() - payment.lastQueriedAt.getTime() > 5000)) {
            payment = await billing.syncCheckout(payment, 'query');
        }
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, data: billing.checkoutStatus(payment) });
    } catch {
        fail(res, 500, 'Internal server error');
    }
};

/* ───────────── PayGate callbacks for plan payments ───────────── */

// The urlencoded body as ordered [name, value] pairs (the checksum is over the
// values in the order PayGate posted them).
const orderedPairs = (req) => {
    if (typeof req.rawBody === 'string') return [...new URLSearchParams(req.rawBody).entries()];
    return Object.entries(req.body || {}).map(([k, v]) => [k, String(v)]);
};
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const tokenizeKey = () => paygate.config(billing.TERMINAL).checksumKey;

// POST /api/subscriptions/paygate/return — the owner's browser, back from PayGate
exports.paygateReturn = async (req, res) => {
    let reference = '';
    try {
        const pairs = orderedPairs(req);
        const get = (k) => (pairs.find(([n]) => n === k) || [])[1] || '';
        const payRequestId = get('PAY_REQUEST_ID');
        if (ID_RE.test(payRequestId)) {
            const payment = await SubscriptionPayment.findOne({ payRequestId });
            if (payment) {
                reference = payment.reference;
                const { paygateId } = paygate.config(billing.TERMINAL);
                const key = tokenizeKey();
                const valid = paygate.verifyReturnChecksum({
                    paygateId, payRequestId, transactionStatus: get('TRANSACTION_STATUS'), reference: payment.reference, checksum: get('CHECKSUM'),
                }, key) || paygate.verifyPostedChecksum(pairs, key);
                if (valid) await billing.syncCheckout(payment, 'return');
                else logger.warn({ subscriptionPaymentId: String(payment._id) }, 'PayGate return checksum (plan) did not verify — not acting on it');
            }
        }
    } catch (err) {
        logger.error({ err: err.message }, 'PayGate return handling (plan) failed');
    }
    // Always to OUR page; the page asks for the status itself.
    res.redirect(303, billing.resultPageUrl(reference));
};

// POST /api/subscriptions/paygate/notify — PayGate's server, expects plain "OK"
exports.paygateNotify = async (req, res) => {
    const pairs = orderedPairs(req);
    if (!paygate.verifyPostedChecksum(pairs, tokenizeKey())) {
        logger.warn({ fields: pairs.map(([k]) => k).filter((k) => k !== 'CHECKSUM') }, 'PayGate notify (plan) with an invalid checksum — rejected');
        return res.status(400).type('text/plain').send('INVALID');
    }
    try {
        const get = (k) => (pairs.find(([n]) => n === k) || [])[1] || '';
        const payRequestId = get('PAY_REQUEST_ID');
        const payment = ID_RE.test(payRequestId) ? await SubscriptionPayment.findOne({ payRequestId }) : null;
        if (!payment) {
            logger.warn('PayGate notify for an unknown plan payment — acknowledged');
        } else if (get('REFERENCE') && get('REFERENCE') !== payment.reference) {
            logger.warn({ subscriptionPaymentId: String(payment._id) }, 'PayGate notify (plan) reference does not match — acknowledged, not acted on');
        } else {
            await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { lastNotify: { ...billing.sanitizeNotify(pairs), receivedAt: new Date() } } });
            await billing.syncCheckout(payment, 'notify');
        }
    } catch (err) {
        // The status check on the owner's page re-asks PayGate, so a failure
        // here is recoverable; still acknowledge.
        logger.error({ err: err.message }, 'PayGate notify handling (plan) failed');
    }
    res.status(200).type('text/plain').send('OK');
};
