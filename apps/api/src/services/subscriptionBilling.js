/**
 * Starting a business's Bookplus plan with a card (behind
 * SUBSCRIPTION_BILLING_ENABLED, off by default).
 *
 * The owner presses "Add card and start plan": Bookplus opens a PayGate
 * session on terminal 1 ("One time and tokenization") for the first month's price, with the
 * card to be saved in PayGate's vault. The owner types the card on PayGate's
 * page (3D Secure); Bookplus never sees it. PayGate sends the browser back
 * (return) and tells our server (notify). Neither is trusted: each is checked
 * by its checksum and then the outcome is read with a server-side Query, and
 * applying it is idempotent, so a return and a notify racing (or arriving
 * twice) start the plan once.
 *
 * What is kept about the card: the vault token (Subscription.vaultId, not
 * selected by default) and brand, last 4 digits and expiry for the owner.
 * The monthly charges on the saved card come later.
 */
const crypto = require('crypto');
const pino = require('pino');
const Subscription = require('../models/Subscription');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const paygate = require('./paygate');
const pricing = require('./pricing');
const subs = require('./subscriptions');
const { subscriptionBillingEnabled } = require('../constants/features');
const { businessOrigin } = require('../utils/origins');
const { recordFinance } = require('../utils/financeAudit');
const { PLAN_TERMS_VERSION } = require('../constants/consent');
const { sendAlert } = require('../utils/alerts');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const TERMINAL = 'tokenize';
const CURRENCY = 'NAD';
const { OPEN } = SubscriptionPayment;
// At most this many card attempts per business per day (each one is a PayGate
// session and, once the card is typed, a fee).
const MAX_ATTEMPTS_PER_DAY = 6;
const DAY = 24 * 60 * 60 * 1000;

const newReference = () => `BS${crypto.randomBytes(15).toString('hex').toUpperCase()}`;
const REFERENCE_RE = /^BS[0-9A-F]{30}$/;

const apiBase = () => String(process.env.PAYGATE_CALLBACK_BASE_URL || process.env.SERVER_URL || '').replace(/\/+$/, '');
const notifyUrl = () => `${apiBase()}/api/subscriptions/paygate/notify`;
const returnUrl = () => `${apiBase()}/api/subscriptions/paygate/return`;
/** Where the owner's browser lands after PayGate: Account -> Your plan. */
const resultPageUrl = (reference) => `${String(businessOrigin() || '').replace(/\/+$/, '')}/account?section=plan${reference ? `&checkout=${encodeURIComponent(reference)}` : ''}`;

/** The day a month after `from` (the 31st becomes the last day of a shorter month). */
const addMonth = (from) => {
    const d = new Date(from);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d;
};

/**
 * Can this business add a card now? Every switch must be on, the business
 * must be on a trial (running or ended) and have no card yet.
 * → { ok: true, amountCents } or { ok: false, reason }
 */
const eligibility = async (sub, now = new Date()) => {
    if (!subscriptionBillingEnabled()) return { ok: false, reason: 'off' };
    const settings = await pricing.getSettings();
    if (!settings.subscriptions?.showToBusinesses) return { ok: false, reason: 'hidden' };
    if (!paygate.isConfigured(TERMINAL) || !paygate.vaultReady()) return { ok: false, reason: 'unavailable' };
    const d = subs.describe(sub, now);
    if (!['trialing', 'trial_ended'].includes(d.status)) return { ok: false, reason: d.status === 'active' ? 'already_active' : 'not_billable' };
    if (!Number.isInteger(d.nextPriceCents) || d.nextPriceCents <= 0) return { ok: false, reason: 'no_price' };
    return { ok: true, amountCents: d.nextPriceCents };
};

const historyEntry = (status, source, note) => ({ status, at: new Date(), source, ...(note ? { note } : {}) });

const splitName = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { firstName: 'Business', lastName: 'Owner' };
    if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

class CheckoutError extends Error {
    constructor(message, { status = 409, code = 'not_possible' } = {}) { super(message); this.status = status; this.code = code; }
}

const REASON_TEXT = {
    off: ['Adding a card is not available yet.', 404],
    hidden: ['Adding a card is not available yet.', 404],
    unavailable: ['Card payments for plans are unavailable right now. Please try again later.', 503],
    already_active: ['Your plan has already started.', 409],
    not_billable: ['Your plan has nothing to pay.', 409],
    no_price: ['Your plan has nothing to pay.', 409],
};

/**
 * Open a PayGate session for the first month, saving the card.
 * → { reference, amountCents, currency, redirectUrl, method: 'POST', fields }
 * Throws CheckoutError.
 */
const startCheckout = async (owner, { acceptTerms = false } = {}, now = new Date()) => {
    const sub = await subs.forProvider(owner, now);
    const e = await eligibility(sub, now);
    if (!e.ok) {
        const [message, status] = REASON_TEXT[e.reason] || ['Not possible.', 409];
        throw new CheckoutError(message, { status, code: e.reason });
    }
    // The owner must agree to the plan terms (the monthly charge authority)
    // every time: what they agreed to is recorded with the payment.
    if (acceptTerms !== true) {
        throw new CheckoutError('Tick the box to agree to the plan terms and the monthly payments first.', { status: 400, code: 'terms_required' });
    }
    const recent = await SubscriptionPayment.countDocuments({ provider: owner._id, createdAt: { $gt: new Date(now.getTime() - DAY) } });
    if (recent >= MAX_ATTEMPTS_PER_DAY) {
        throw new CheckoutError('Too many card attempts today. Please try again tomorrow.', { status: 429, code: 'too_many_attempts' });
    }

    const payment = await SubscriptionPayment.create({
        subscription: sub._id,
        provider: owner._id,
        kind: 'first',
        amountCents: e.amountCents,
        currency: CURRENCY,
        reference: newReference(),
        termsVersion: PLAN_TERMS_VERSION,
        termsAcceptedAt: now,
        termsAcceptedBy: owner._id,
        statusHistory: [historyEntry('initiated', 'initiate')],
    });
    // A money action that cannot be recorded must not go ahead.
    await recordFinance({
        actor: owner, action: 'subscription.checkout_start', amountCents: e.amountCents, currency: CURRENCY,
        provider: owner._id, reference: payment.reference, details: { subscription: String(sub._id), kind: 'first', termsVersion: PLAN_TERMS_VERSION, termsAcceptedAt: now },
    });

    let res;
    try {
        res = await paygate.initiate({
            terminal: TERMINAL,
            vault: true,
            reference: payment.reference,
            amountCents: e.amountCents,
            currency: CURRENCY,
            customer: { ...splitName(owner.name), email: owner.email },
            notifyUrl: notifyUrl(),
            returnUrl: returnUrl(),
        });
    } catch (err) {
        res = { ok: false, error: { code: err.code || 'ERROR', message: err.message } };
    }
    const failStart = async (note) => {
        await SubscriptionPayment.updateOne({ _id: payment._id }, {
            $set: { status: 'failed', resultDesc: String(note || '').slice(0, 200) },
            $push: { statusHistory: historyEntry('failed', 'initiate', note) },
        });
        logger.warn({ subscriptionPaymentId: String(payment._id), note }, 'PayGate session for a plan could not be started');
        throw new CheckoutError('Card payments for plans are unavailable right now. Please try again in a few minutes.', { status: 502, code: 'gateway' });
    };
    if (!res.ok) await failStart(res.error?.code);
    // PayGate must echo our own reference back.
    if (res.fields.REFERENCE && res.fields.REFERENCE !== payment.reference) await failStart('reference mismatch on initiate');

    await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { payRequestId: res.payRequestId } });
    return {
        reference: payment.reference,
        amountCents: payment.amountCents,
        currency: payment.currency,
        redirectUrl: res.redirectUrl,
        method: 'POST',
        fields: res.fields,
    };
};

const STATUS_FOR_CODE = {
    [paygate.TX.DECLINED]: 'failed',
    [paygate.TX.SETTLEMENT_VOIDED]: 'failed',
    [paygate.TX.CANCELLED]: 'cancelled',
    [paygate.TX.USER_CANCELLED]: 'cancelled',
};

const alertSafe = (title, body) => { sendAlert(title, body).catch(() => {}); };

/**
 * Put a paid first payment into effect on the subscription. Idempotent: the
 * update only matches while the subscription has not had this payment applied
 * (lastPaymentRef), so running it again, or in parallel, changes nothing.
 */
const applyPaid = async (paymentId, card, now = new Date()) => {
    const payment = await SubscriptionPayment.findById(paymentId).lean();
    if (!payment || payment.status !== 'paid') return false;
    const sub = await Subscription.findById(payment.subscription).lean();
    if (!sub) return false;
    // The paid month starts when the trial would have ended, so adding a card
    // early never shortens the free trial.
    const trialEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const start = trialEnd && trialEnd > (payment.paidAt || now) ? trialEnd : (payment.paidAt || now);
    const set = {
        status: 'active',
        paidThrough: addMonth(start),
        lastPaymentRef: payment.reference,
        // The agreement the owner gave for this payment becomes the plan's.
        termsAccepted: {
            version: payment.termsVersion || null,
            at: payment.termsAcceptedAt || null,
            by: payment.termsAcceptedBy || null,
            paymentRef: payment.reference,
        },
    };
    if (card) {
        Object.assign(set, {
            vaultId: card.vaultId,
            card: { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear, savedAt: now },
        });
    }
    const r = await Subscription.updateOne(
        { _id: sub._id, lastPaymentRef: { $ne: payment.reference }, status: { $in: ['trialing', 'trial_ended'] } },
        {
            $set: set,
            $inc: { paidMonths: 1 },
            $push: { history: { at: now, event: card ? 'plan_started' : 'plan_started_no_card', note: `First payment ${payment.reference}` } },
        },
    );
    await SubscriptionPayment.updateOne({ _id: payment._id, appliedAt: null }, { $set: { appliedAt: now } });
    if (!r.modifiedCount) {
        const fresh = await Subscription.findById(sub._id).select('lastPaymentRef status').lean();
        if (fresh && fresh.lastPaymentRef !== payment.reference) {
            // Paid, but the subscription was moved meanwhile (e.g. kept free by
            // a director). Not applied; Bookplus decides (a refund, or credit).
            await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { flagged: true, flagReason: `Paid while the plan was ${fresh.status}; not applied` } });
            alertSafe('Plan payment not applied', `Subscription payment ${payment._id} was paid while the plan was ${fresh.status}.`);
        }
    }
    return r.modifiedCount === 1;
};

/**
 * Apply a Query answer (paygate.query()'s shape) to a plan payment. The only
 * place its outcome is decided.
 */
const applyQueryResult = async (payment, q, source, now = new Date()) => {
    if (!q || !q.ok) {
        await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { lastQueriedAt: now } });
        return SubscriptionPayment.findById(payment._id);
    }
    const code = q.transactionStatusCode;
    const gatewayFields = {
        lastQueriedAt: now,
        transactionStatusCode: code,
        ...(q.transactionId ? { transactionId: String(q.transactionId).slice(0, 64) } : {}),
        ...(q.resultCode ? { resultCode: String(q.resultCode).slice(0, 20) } : {}),
        ...(q.resultDescription || q.transactionStatusDescription ? { resultDesc: String(q.resultDescription || q.transactionStatusDescription).slice(0, 200) } : {}),
        ...(q.payMethod ? { payMethod: String(q.payMethod).slice(0, 40) } : {}),
    };

    if (code === paygate.TX.APPROVED) {
        const problems = [];
        if (!q.reference || q.reference !== payment.reference) problems.push('reference');
        if (q.amountCents !== payment.amountCents) problems.push('amount');
        if (!q.currency || String(q.currency).toUpperCase() !== payment.currency) problems.push('currency');
        if (problems.length) {
            const reason = `PayGate approved but ${problems.join(', ')} did not match`;
            await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { ...gatewayFields, flagged: true, flagReason: reason } });
            logger.error({ subscriptionPaymentId: String(payment._id), mismatch: problems }, 'Plan payment mismatch — plan not started');
            alertSafe('Plan payment mismatch — plan NOT started', `Subscription payment ${payment._id}: ${reason}`);
            return SubscriptionPayment.findById(payment._id);
        }
        const card = paygate.cardSummary(q.vault);
        const claimed = await SubscriptionPayment.findOneAndUpdate(
            { _id: payment._id, status: { $in: [...OPEN, 'failed', 'cancelled', 'expired'] } },
            {
                $set: {
                    ...gatewayFields, status: 'paid', paidAt: now,
                    ...(card ? {} : { flagged: true, flagReason: 'Paid, but PayGate did not return a saved card' }),
                },
                $push: { statusHistory: historyEntry('paid', source) },
            },
            { new: true },
        );
        if (claimed) {
            // Only the one call that moved it to paid writes the audit entry.
            await recordFinance({
                action: 'subscription.first_payment', amountCents: payment.amountCents, currency: payment.currency,
                provider: payment.provider, reference: payment.reference,
                details: { source, cardSaved: !!card, brand: card?.brand || null, last4: card?.last4 || null, termsVersion: payment.termsVersion || null },
            });
            if (!card) alertSafe('Plan paid without a saved card', `Subscription payment ${payment._id}: PayGate approved it but returned no card token.`);
        } else {
            await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { lastQueriedAt: now } });
        }
        // Whoever claimed it, or a re-run after a crash between the claim and
        // applying it, makes sure it is applied; applyPaid is idempotent.
        await applyPaid(payment._id, card, now);
        return SubscriptionPayment.findById(payment._id);
    }

    const next = STATUS_FOR_CODE[code] || (code === paygate.TX.RECEIVED ? 'pending' : null);
    if (next) {
        const from = next === 'pending' ? ['initiated'] : OPEN;
        const moved = await SubscriptionPayment.findOneAndUpdate(
            { _id: payment._id, status: { $in: from } },
            { $set: { ...gatewayFields, status: next }, $push: { statusHistory: historyEntry(next, source) } },
            { new: true },
        );
        if (moved) {
            if (next !== 'pending') {
                await recordFinance({
                    action: 'subscription.payment_failed', amountCents: payment.amountCents, currency: payment.currency,
                    provider: payment.provider, reference: payment.reference,
                    details: { source, status: next, resultCode: gatewayFields.resultCode || null },
                });
            }
            return moved;
        }
    }
    await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { lastQueriedAt: now } });
    return SubscriptionPayment.findById(payment._id);
};

/** Ask PayGate for the truth about a plan payment and apply it. */
const syncCheckout = async (payment, source = 'query') => {
    if (!payment || !payment.payRequestId) return payment;
    let q;
    try {
        q = await paygate.query({ payRequestId: payment.payRequestId, terminal: TERMINAL });
    } catch (err) {
        logger.warn({ subscriptionPaymentId: String(payment._id), code: err.code }, 'PayGate query for a plan payment failed');
        q = { ok: false };
    }
    return applyQueryResult(payment, q, source);
};

/** What the owner's result view shows about one of their plan payments. */
const checkoutStatus = (payment) => ({
    reference: payment.reference,
    status: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
});

/** The owner's card on file, for Account -> Your plan (never the token). */
const publicCard = (sub) => (sub?.card?.last4 ? {
    brand: sub.card.brand || null, last4: sub.card.last4, expMonth: sub.card.expMonth || null, expYear: sub.card.expYear || null,
} : null);

/* ── notify payload hygiene ── */
const NOTIFY_KEEP = new Set([
    'PAYGATE_ID', 'PAY_REQUEST_ID', 'REFERENCE', 'TRANSACTION_STATUS', 'RESULT_CODE', 'AUTH_CODE', 'CURRENCY',
    'AMOUNT', 'RESULT_DESC', 'TRANSACTION_ID', 'PAY_METHOD', 'PAY_METHOD_DETAIL',
]);
/** Known, non-sensitive notify fields only (never a vault token or card data). */
const sanitizeNotify = (pairs) => {
    const out = {};
    for (const [k, v] of pairs || []) {
        if (!NOTIFY_KEEP.has(k)) continue;
        out[k] = String(v == null ? '' : v).slice(0, 200).replace(/\d{12,19}/g, (d) => `****${d.slice(-4)}`);
    }
    return out;
};

module.exports = {
    TERMINAL, REFERENCE_RE, MAX_ATTEMPTS_PER_DAY, CheckoutError,
    notifyUrl, returnUrl, resultPageUrl, addMonth,
    eligibility, startCheckout, applyQueryResult, applyPaid, syncCheckout,
    checkoutStatus, publicCard, sanitizeNotify,
};
