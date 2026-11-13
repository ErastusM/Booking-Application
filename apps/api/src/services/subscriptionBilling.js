/**
 * Paying for a business's Bookplus plan by card (behind
 * SUBSCRIPTION_BILLING_ENABLED, off by default).
 *
 * Three kinds of payment (models/SubscriptionPayment.js), one place that
 * decides their outcome (applyQueryResult):
 *
 *   first    "Add card and start plan": a PayGate session on terminal 1
 *            ("One time and tokenization", 3D Secure) for the first month,
 *            saving the card in PayGate's vault. Adding a card during the
 *            trial never shortens it: the paid month starts when it ends.
 *   card     "Replace card" / "Pay with another card", once a plan has
 *            started: the same hosted page, paying the next month with the
 *            new card, which then replaces the saved one (the old one is
 *            deleted at PayGate).
 *   renewal  the monthly payment from the saved card on terminal 2 ("NON3DS",
 *            nobody present), started by services/subscriptionRenewals.js.
 *
 * Callbacks (return, notify) are never trusted on their own: each is checked
 * by its checksum and then the outcome is read with a server-side Query.
 * Applying a payment is idempotent, and only applies while the plan is still
 * paid to where it was when the payment started, so a notify and a return
 * racing, or a renewal and a new card racing, never pay a month twice
 * without it being flagged.
 *
 * What is kept about the card: the vault token (Subscription.vaultId, not
 * selected by default) and brand, last 4 digits and expiry for the owner.
 */
const crypto = require('crypto');
const pino = require('pino');
const Subscription = require('../models/Subscription');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const User = require('../models/User');
const VaultDeletion = require('../models/VaultDeletion');
const paygate = require('./paygate');
const pricing = require('./pricing');
const subs = require('./subscriptions');
const { subscriptionBillingEnabled } = require('../constants/features');
const { businessOrigin } = require('../utils/origins');
const { recordFinance } = require('../utils/financeAudit');
const { PLAN_TERMS_VERSION } = require('../constants/consent');
const { sendAlert } = require('../utils/alerts');
const { createNotification } = require('../utils/notificationhelper');
const { sendPlanEmail } = require('../utils/emailService');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const TERMINAL = 'tokenize';
const RECURRING_TERMINAL = 'recurring';
const CURRENCY = 'NAD';
const { OPEN } = SubscriptionPayment;
// At most this many card attempts per business per day (each one is a PayGate
// session and, once the card is typed, a fee).
const MAX_ATTEMPTS_PER_DAY = 6;
const DAY = 24 * 60 * 60 * 1000;
// A monthly payment that does not go through is tried again this many days
// after the first failure, and the plan is paused GRACE_DAYS after it if the
// month is still unpaid (Business Terms, "Your Bookplus plan").
const RETRY_AFTER_DAYS = [1, 3, 5];
const GRACE_DAYS = 7;
// A new-card session older than this no longer holds back a renewal.
const CARD_SESSION_MS = 60 * 60 * 1000;

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

const nad = (cents) => `N$${(Number(cents || 0) / 100).toFixed(2)}`;
const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Windhoek' });

/** Every setting and both terminals needed for plan payments by card. */
const cardsReady = () => paygate.isConfigured(TERMINAL) && paygate.isConfigured(RECURRING_TERMINAL) && paygate.recurringReady();

const FIRST_FROM = ['trialing', 'trial_ended', 'cancelled'];
const CARD_FROM = ['active', 'past_due', 'paused'];

/**
 * The month a new card pays for: the one after the month paid to (the next
 * one, or the overdue one while past due), or a month from today once the plan
 * is paused (the business was not listed meanwhile).
 */
const cardPeriod = (sub, now) => ({
    prevPaidThrough: sub.paidThrough || null,
    periodStart: sub.status === 'paused' || !sub.paidThrough ? now : new Date(sub.paidThrough),
});
const sameTime = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/**
 * What a card payment would be for this business now.
 * → { ok: true, kind: 'first' | 'card', amountCents, periodStart?, prevPaidThrough? }
 * → { ok: false, reason }
 */
const eligibility = async (sub, now = new Date()) => {
    if (!subscriptionBillingEnabled()) return { ok: false, reason: 'off' };
    const settings = await pricing.getSettings();
    if (!settings.subscriptions?.showToBusinesses) return { ok: false, reason: 'hidden' };
    if (!cardsReady()) return { ok: false, reason: 'unavailable' };
    const d = subs.describe(sub, now);
    if (!Number.isInteger(d.nextPriceCents) || d.nextPriceCents <= 0) return { ok: false, reason: d.status === 'exempt' ? 'not_billable' : 'no_price' };
    if (FIRST_FROM.includes(d.status)) return { ok: true, kind: 'first', amountCents: d.nextPriceCents };
    if (!CARD_FROM.includes(d.status)) return { ok: false, reason: 'not_billable' };
    if (sub.cancelAtPeriodEnd) return { ok: false, reason: 'cancelling' };
    // A monthly payment from the saved card is being taken right now.
    const renewing = sub.chargingAt || await SubscriptionPayment.exists({ subscription: sub._id, kind: 'renewal', status: { $in: OPEN } });
    if (renewing) return { ok: false, reason: 'busy' };
    return { ok: true, kind: 'card', amountCents: d.nextPriceCents, ...cardPeriod(sub, now) };
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
    not_billable: ['Your plan has nothing to pay.', 409],
    no_price: ['Your plan has nothing to pay.', 409],
    cancelling: ['Your plan is cancelled and ends at the end of the month you paid for. Keep your plan first to change the card.', 409],
    busy: ['Your monthly payment is being taken right now. Please try again in a few minutes.', 409],
};

/**
 * Open a PayGate session (terminal 1, saving the card): the first month, or
 * the next month with a new card.
 * → { reference, kind, amountCents, currency, redirectUrl, method: 'POST', fields }
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
    const recent = await SubscriptionPayment.countDocuments({ provider: owner._id, kind: { $in: ['first', 'card'] }, createdAt: { $gt: new Date(now.getTime() - DAY) } });
    if (recent >= MAX_ATTEMPTS_PER_DAY) {
        throw new CheckoutError('Too many card attempts today. Please try again tomorrow.', { status: 429, code: 'too_many_attempts' });
    }

    const payment = await SubscriptionPayment.create({
        subscription: sub._id,
        provider: owner._id,
        kind: e.kind,
        terminal: TERMINAL,
        amountCents: e.amountCents,
        currency: CURRENCY,
        reference: newReference(),
        ...(e.kind === 'card' ? { periodStart: e.periodStart, prevPaidThrough: e.prevPaidThrough } : {}),
        termsVersion: PLAN_TERMS_VERSION,
        termsAcceptedAt: now,
        termsAcceptedBy: owner._id,
        statusHistory: [historyEntry('initiated', 'initiate')],
    });
    // A money action that cannot be recorded must not go ahead.
    await recordFinance({
        actor: owner, action: 'subscription.checkout_start', amountCents: e.amountCents, currency: CURRENCY,
        provider: owner._id, reference: payment.reference, details: { subscription: String(sub._id), kind: e.kind, termsVersion: PLAN_TERMS_VERSION, termsAcceptedAt: now },
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
        kind: e.kind,
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

/** Tell the owner about their plan: in the app and by email. Never throws. */
const tellOwner = async (providerId, { message, subject, heading, lines, rows }) => {
    try {
        await createNotification(providerId, message, 'system', '/account?section=plan');
        const owner = await User.findById(providerId).select('name email').lean();
        if (owner?.email) await sendPlanEmail(owner.email, { name: owner.name, subject, heading, lines: lines || [message], rows });
    } catch (err) {
        logger.warn({ err: err.message }, 'Telling the owner about their plan failed (non-fatal)');
    }
};

/** Queue a saved card for deletion at PayGate (services/subscriptionRenewals.js runs the queue). */
const queueVaultDeletion = async ({ provider, subscription, vaultId, last4, reason }) => {
    if (!vaultId) return null;
    return VaultDeletion.create({ provider, subscription, vaultId, last4: last4 || null, reason });
};

/** The plan is paid again: shown to clients and bookable, if it was paused. */
const unpauseListing = (providerId) => User.updateOne({ _id: providerId, billingPausedAt: { $ne: null } }, { $set: { billingPausedAt: null } });

const RESET_RETRY = { 'retry.firstFailedAt': null, 'retry.attempts': 0, 'retry.nextAttemptAt': null, 'retry.graceEndsAt': null, pausedAt: null };

// Paid, but the plan moved meanwhile: not applied. Bookplus decides (a refund, or credit).
const flagNotApplied = async (payment, fresh) => {
    const why = fresh ? `Paid while the plan was ${fresh.status}${fresh.cancelAtPeriodEnd ? ' (cancelling)' : ''}; not applied` : 'Paid, but the plan was not found; not applied';
    await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { flagged: true, flagReason: why } });
    alertSafe('Plan payment not applied', `Subscription payment ${payment._id} (${payment.kind}): ${why}.`);
};

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
    const trialEnd = sub.status !== 'cancelled' && sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const start = trialEnd && trialEnd > (payment.paidAt || now) ? trialEnd : (payment.paidAt || now);
    const set = {
        status: 'active',
        paidThrough: addMonth(start),
        lastPaymentRef: payment.reference,
        lastPriceCents: payment.amountCents,
        cancelAtPeriodEnd: false,
        cancelRequestedAt: null,
        endedAt: null,
        ...RESET_RETRY,
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
        { _id: sub._id, lastPaymentRef: { $ne: payment.reference }, status: { $in: FIRST_FROM } },
        {
            $set: set,
            $inc: { paidMonths: 1 },
            $push: { history: { at: now, event: card ? 'plan_started' : 'plan_started_no_card', note: `First payment ${payment.reference}` } },
        },
    );
    await SubscriptionPayment.updateOne({ _id: payment._id, appliedAt: null }, { $set: { appliedAt: now } });
    if (r.modifiedCount) {
        await unpauseListing(payment.provider);
    } else {
        const fresh = await Subscription.findById(sub._id).select('lastPaymentRef status cancelAtPeriodEnd').lean();
        if (!fresh || fresh.lastPaymentRef !== payment.reference) await flagNotApplied(payment, fresh);
    }
    return r.modifiedCount === 1;
};

/**
 * A paid month on top of a started plan (a new card, or the saved card each
 * month): the plan is paid to a month after periodStart, provided it is still
 * paid to where it was when the payment started. Idempotent.
 */
const applyMonthPaid = async (paymentId, card, now = new Date()) => {
    const payment = await SubscriptionPayment.findById(paymentId).lean();
    if (!payment || payment.status !== 'paid') return false;
    const before = await Subscription.findById(payment.subscription).select('+vaultId').lean();
    if (!before) return false;
    const set = {
        status: 'active',
        paidThrough: addMonth(payment.periodStart),
        lastPaymentRef: payment.reference,
        lastPriceCents: payment.amountCents,
        ...RESET_RETRY,
    };
    if (payment.kind === 'card') {
        set.termsAccepted = { version: payment.termsVersion || null, at: payment.termsAcceptedAt || null, by: payment.termsAcceptedBy || null, paymentRef: payment.reference };
        if (card) {
            Object.assign(set, { vaultId: card.vaultId, card: { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear, savedAt: now } });
        }
    }
    const event = payment.kind === 'renewal' ? 'renewed' : (card ? 'card_replaced' : 'paid_with_card');
    const r = await Subscription.updateOne(
        {
            _id: before._id,
            lastPaymentRef: { $ne: payment.reference },
            status: { $in: CARD_FROM },
            paidThrough: payment.prevPaidThrough,
            // A renewal is only ever started for a plan that is not cancelling;
            // a new card is refused once it is (eligibility).
            cancelAtPeriodEnd: { $ne: true },
        },
        { $set: set, $inc: { paidMonths: 1 }, $push: { history: { at: now, event, note: `Payment ${payment.reference}` } } },
    );
    await SubscriptionPayment.updateOne({ _id: payment._id, appliedAt: null }, { $set: { appliedAt: now } });
    if (!r.modifiedCount) {
        const fresh = await Subscription.findById(before._id).select('lastPaymentRef status cancelAtPeriodEnd').lean();
        if (!fresh || fresh.lastPaymentRef !== payment.reference) await flagNotApplied(payment, fresh);
        return false;
    }
    await unpauseListing(payment.provider);
    // The card it replaced is deleted at PayGate.
    if (payment.kind === 'card' && card && before.vaultId && before.vaultId !== card.vaultId) {
        await queueVaultDeletion({ provider: payment.provider, subscription: before._id, vaultId: before.vaultId, last4: before.card?.last4, reason: 'card_replaced' });
    }
    const paidThrough = set.paidThrough;
    if (payment.kind === 'renewal') {
        await tellOwner(payment.provider, {
            message: `Your Bookplus plan payment of ${nad(payment.amountCents)} went through. Your plan is paid to ${day(paidThrough)}.`,
            subject: 'Your Bookplus plan payment',
            heading: 'your plan payment went through',
            rows: [['Amount', nad(payment.amountCents)], ['Card', before.card?.last4 ? `ending ${before.card.last4}` : 'saved card'], ['Paid to', day(paidThrough)], ['Reference', payment.reference]],
        });
    } else if (before.status !== 'active') {
        await tellOwner(payment.provider, {
            message: `Thank you: your Bookplus plan is paid to ${day(paidThrough)}${before.status === 'paused' ? ' and your business is shown to clients again' : ''}.`,
            subject: 'Your Bookplus plan is paid',
            heading: 'your plan is paid',
        });
    }
    return true;
};

/**
 * A monthly payment from the saved card did not go through: the plan becomes
 * past due (still listed), the next try is scheduled, and the owner is told.
 * Only while the plan is still paid to where the payment started from.
 */
const applyRenewalFailed = async (payment, now = new Date()) => {
    const sub = await Subscription.findById(payment.subscription).lean();
    if (!sub || !['active', 'past_due'].includes(sub.status)) return;
    if (!sameTime(sub.paidThrough, payment.prevPaidThrough)) return;
    const first = sub.status === 'past_due' && sub.retry?.firstFailedAt ? new Date(sub.retry.firstFailedAt) : now;
    const attempts = (sub.status === 'past_due' ? sub.retry?.attempts || 0 : 0) + 1;
    const offset = RETRY_AFTER_DAYS[attempts - 1];
    const graceEndsAt = sub.status === 'past_due' && sub.retry?.graceEndsAt ? new Date(sub.retry.graceEndsAt) : new Date(first.getTime() + GRACE_DAYS * DAY);
    const nextAttemptAt = offset != null && first.getTime() + offset * DAY < graceEndsAt.getTime() ? new Date(first.getTime() + offset * DAY) : null;
    const r = await Subscription.updateOne(
        { _id: sub._id, status: { $in: ['active', 'past_due'] }, paidThrough: payment.prevPaidThrough },
        {
            $set: { status: 'past_due', 'retry.firstFailedAt': first, 'retry.attempts': attempts, 'retry.nextAttemptAt': nextAttemptAt, 'retry.graceEndsAt': graceEndsAt },
            $push: { history: { at: now, event: 'payment_failed', note: `Payment ${payment.reference}, try ${attempts}` } },
        },
    );
    if (!r.modifiedCount) return;
    const lines = [
        `Your Bookplus plan payment of ${nad(payment.amountCents)} from your saved card did not go through.`,
        nextAttemptAt ? `We will try again on ${day(nextAttemptAt)}.` : 'We will not try this card again.',
        `You can pay with another card in Account, Your plan. If the month is still unpaid on ${day(graceEndsAt)}, your plan is paused: your business is not shown to clients and they cannot make new bookings until it is paid. Your bookings, clients and information are kept.`,
    ];
    await tellOwner(payment.provider, {
        message: lines.slice(0, 2).join(' '),
        subject: 'Your Bookplus plan payment did not go through',
        heading: 'your plan payment did not go through',
        lines,
    });
};

/**
 * Apply a Query (or charge) answer, paygate.query()'s shape, to a plan
 * payment. The only place its outcome is decided.
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
        ...(q.payRequestId && !payment.payRequestId ? { payRequestId: String(q.payRequestId).slice(0, 64) } : {}),
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
            logger.error({ subscriptionPaymentId: String(payment._id), mismatch: problems }, 'Plan payment mismatch — not applied');
            alertSafe('Plan payment mismatch — NOT applied', `Subscription payment ${payment._id} (${payment.kind}): ${reason}`);
            return SubscriptionPayment.findById(payment._id);
        }
        // A renewal charges the card already saved; the others save a new one.
        const card = payment.kind === 'renewal' ? null : paygate.cardSummary(q.vault);
        const noCard = payment.kind !== 'renewal' && !card;
        const claimed = await SubscriptionPayment.findOneAndUpdate(
            { _id: payment._id, status: { $in: [...OPEN, 'failed', 'cancelled', 'expired'] } },
            {
                $set: {
                    ...gatewayFields, status: 'paid', paidAt: now,
                    ...(noCard ? { flagged: true, flagReason: 'Paid, but PayGate did not return a saved card' } : {}),
                },
                $push: { statusHistory: historyEntry('paid', source) },
            },
            { new: true },
        );
        if (claimed) {
            // Only the one call that moved it to paid writes the audit entry.
            const action = { first: 'subscription.first_payment', card: 'subscription.card_payment', renewal: 'subscription.renewal_payment' }[payment.kind];
            await recordFinance({
                action, amountCents: payment.amountCents, currency: payment.currency,
                provider: payment.provider, reference: payment.reference,
                details: {
                    source, kind: payment.kind,
                    ...(payment.kind === 'renewal' ? { attempt: payment.attempt, periodStart: payment.periodStart } : { cardSaved: !!card, brand: card?.brand || null, last4: card?.last4 || null, termsVersion: payment.termsVersion || null }),
                },
            });
            if (noCard) alertSafe('Plan paid without a saved card', `Subscription payment ${payment._id}: PayGate approved it but returned no card token.`);
        } else {
            await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { lastQueriedAt: now } });
        }
        // Whoever claimed it, or a re-run after a crash between the claim and
        // applying it, makes sure it is applied; applying is idempotent.
        if (payment.kind === 'first') await applyPaid(payment._id, card, now);
        else await applyMonthPaid(payment._id, card, now);
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
                // PayGate can save the card before the payment fails: it is not
                // kept, so ask PayGate to delete it.
                const orphan = payment.kind !== 'renewal' ? paygate.cardSummary(q.vault) : null;
                const saved = orphan ? await Subscription.findById(payment.subscription).select('+vaultId').lean() : null;
                // Never the card the plan is using (in case PayGate hands back the same token).
                if (orphan && saved?.vaultId !== orphan.vaultId) await queueVaultDeletion({ provider: payment.provider, subscription: payment.subscription, vaultId: orphan.vaultId, last4: orphan.last4, reason: 'payment_failed' });
                await recordFinance({
                    action: 'subscription.payment_failed', amountCents: payment.amountCents, currency: payment.currency,
                    provider: payment.provider, reference: payment.reference,
                    details: { source, kind: payment.kind, status: next, resultCode: gatewayFields.resultCode || null, ...(payment.kind === 'renewal' ? { attempt: payment.attempt } : {}) },
                });
                if (payment.kind === 'renewal') await applyRenewalFailed(moved, now);
            }
            return moved;
        }
    }
    // Still not settled (or already settled): keep PayGate's id so it can be asked again.
    await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { lastQueriedAt: now, ...(gatewayFields.payRequestId ? { payRequestId: gatewayFields.payRequestId } : {}) } });
    return SubscriptionPayment.findById(payment._id);
};

/** Ask PayGate for the truth about a plan payment and apply it. */
const syncCheckout = async (payment, source = 'query') => {
    if (!payment || !payment.payRequestId) return payment;
    let q;
    try {
        q = await paygate.query({ payRequestId: payment.payRequestId, terminal: payment.terminal || TERMINAL });
    } catch (err) {
        logger.warn({ subscriptionPaymentId: String(payment._id), code: err.code }, 'PayGate query for a plan payment failed');
        q = { ok: false };
    }
    return applyQueryResult(payment, q, source);
};

/** What the owner's result view shows about one of their plan payments. */
const checkoutStatus = (payment) => ({
    reference: payment.reference,
    kind: payment.kind,
    status: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
});

/** The owner's paid plan payments, newest first (Account -> Your plan). */
const paymentHistory = async (providerId, limit = 24) => {
    const rows = await SubscriptionPayment.find({ provider: providerId, status: 'paid' })
        .sort({ paidAt: -1 }).limit(limit).select('reference kind amountCents currency paidAt periodStart').lean();
    return rows.map((r) => ({ reference: r.reference, kind: r.kind, amountCents: r.amountCents, currency: r.currency, paidAt: r.paidAt }));
};

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
    TERMINAL, RECURRING_TERMINAL, REFERENCE_RE, MAX_ATTEMPTS_PER_DAY, RETRY_AFTER_DAYS, GRACE_DAYS, CARD_SESSION_MS, CheckoutError,
    notifyUrl, returnUrl, resultPageUrl, addMonth, nad, day, cardsReady,
    eligibility, startCheckout, applyQueryResult, applyPaid, applyMonthPaid, applyRenewalFailed, syncCheckout,
    checkoutStatus, paymentHistory, publicCard, sanitizeNotify, tellOwner, queueVaultDeletion, unpauseListing, newReference, splitName,
};
