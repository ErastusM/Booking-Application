/**
 * The monthly side of a business's Bookplus plan (behind
 * SUBSCRIPTION_BILLING_ENABLED, off by default), run hourly by one API
 * instance at a time (startRenewalJob), and the owner's cancel / keep:
 *
 *  - Renewals: a plan paid to a date that has passed is charged on the saved
 *    card, on terminal 2 ("NON3DS", nobody present), for the month that
 *    starts there.
 *  - A payment that does not go through makes the plan past due (still
 *    listed): it is tried again 1, 3 and 5 days after the first failure, and
 *    the owner can pay with another card meanwhile. Still unpaid 7 days after
 *    the first failure: the plan is paused. Clients cannot make new online
 *    bookings (utils/publicProvider) until a month is paid with a card; the
 *    business stays listed and keeps its dashboard, calendar and data.
 *  - Price rises (the introductory price ending): the owner is told at least
 *    14 days before the first payment at the new price. A month whose rise
 *    was not told in time is charged at the old price.
 *  - The free trial: the owner is reminded 7 days and 1 day before it ends.
 *    If it ends with no month paid, clients cannot make new online bookings
 *    until the first month is paid (the same pause, nothing deleted).
 *  - Cancelling: nothing more is charged, the plan runs to the end of the
 *    month paid for, then ends. Cancelling while a month is unpaid ends the
 *    plan at once. Closing the account ends it at once.
 *  - When a plan ends, or a card is replaced, PayGate is asked to delete the
 *    saved card (a queue, retried until PayGate confirms).
 *
 * Safety: a subscription is claimed (chargingAt) before its card is charged,
 * and never charged while a monthly payment for it is still open; an open one
 * is asked about first. A charge whose outcome is unknown (PayGate could not
 * be reached mid-request) is never retried automatically: it is flagged and
 * the team is alerted, because the card may have been charged.
 */
const cron = require('node-cron');
const pino = require('pino');
const Subscription = require('../models/Subscription');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const User = require('../models/User');
const VaultDeletion = require('../models/VaultDeletion');
const paygate = require('./paygate');
const subs = require('./subscriptions');
const billing = require('./subscriptionBilling');
const { subscriptionBillingEnabled } = require('../constants/features');
const { recordFinance } = require('../utils/financeAudit');
const { sendAlert } = require('../utils/alerts');
const { withLock } = require('../utils/lock');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const { OPEN } = SubscriptionPayment;
const CLAIM_MS = 30 * 60 * 1000;
const MAX_DELETE_ATTEMPTS = 10;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Business Terms, "Price changes": at least 14 days' notice. Sent from 15
// days before, so an hourly job always gives the full 14.
const PRICE_NOTICE_DAYS = 14;
const PRICE_NOTICE_SEND_DAYS = 15;
const alertSafe = (title, body) => { sendAlert(title, body).catch(() => {}); };
const historyEntry = (status, source, note) => ({ status, at: new Date(), source, ...(note ? { note } : {}) });

class PlanError extends Error {
    constructor(message, { status = 409, code = 'not_possible' } = {}) { super(message); this.status = status; this.code = code; }
}

/* ───────────────────────── price rises ───────────────────────── */

/** The price of the month last paid (what was charged), and of the next one (cents). */
const prices = (sub) => {
    const t = sub.terms || {};
    const paid = sub.paidMonths || 0;
    const priceFor = (n) => (n < (t.introMonths || 0) ? t.introPriceCents : t.priceCents);
    const last = Number.isInteger(sub.lastPriceCents) ? sub.lastPriceCents : (paid > 0 ? priceFor(paid - 1) : null);
    return { last, next: priceFor(paid) };
};
const sameTime = (a, b) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();
/** Was the owner told in time about the rise in the payment due at sub.paidThrough? */
const riseToldInTime = (sub) => sameTime(sub.priceNotice?.forPaidThrough, sub.paidThrough)
    && new Date(sub.priceNotice.sentAt).getTime() <= new Date(sub.paidThrough).getTime() - PRICE_NOTICE_DAYS * DAY;

/** Tell owners whose next monthly payment is at a higher price, 15 days ahead. */
const notifyPriceRises = async (now = new Date()) => {
    const soon = await Subscription.find({
        status: 'active', cancelAtPeriodEnd: { $ne: true },
        paidThrough: { $gt: now, $lte: new Date(now.getTime() + PRICE_NOTICE_SEND_DAYS * DAY) },
    }).lean();
    let n = 0;
    for (const sub of soon) {
        const { last, next } = prices(sub);
        if (!(last != null && next > last)) continue;
        if (sameTime(sub.priceNotice?.forPaidThrough, sub.paidThrough)) continue;
        const r = await Subscription.updateOne(
            { _id: sub._id, paidThrough: sub.paidThrough, 'priceNotice.forPaidThrough': { $ne: sub.paidThrough } },
            { $set: { 'priceNotice.forPaidThrough': sub.paidThrough, 'priceNotice.sentAt': now }, $push: { history: { at: now, event: 'price_notice', note: `${billing.nad(last)} to ${billing.nad(next)} from ${billing.day(sub.paidThrough)}` } } },
        );
        if (!r.modifiedCount) continue;
        n += 1;
        await billing.tellOwner(sub.provider, {
            message: `Your introductory price ends: from ${billing.day(sub.paidThrough)} your Bookplus plan is ${billing.nad(next)} a month (now ${billing.nad(last)}).`,
            subject: 'Your Bookplus plan price from next month',
            heading: 'your plan price is changing',
            lines: [
                `Your introductory months are ending. From your payment on ${billing.day(sub.paidThrough)}, your Bookplus plan is ${billing.nad(next)} a month instead of ${billing.nad(last)}.`,
                'If you do not want to continue at the new price, you can cancel in Account, Your plan before then. Your plan then stays active until the end of the month you have paid for.',
            ],
            rows: [['Now', `${billing.nad(last)} a month`], ['From', billing.day(sub.paidThrough)], ['New price', `${billing.nad(next)} a month`]],
        });
    }
    return n;
};

/* ───────────────────────── charging the saved card ───────────────────────── */

const isDue = (sub, now) => (sub.status === 'active' && !sub.cancelAtPeriodEnd && sub.paidThrough && new Date(sub.paidThrough) <= now)
    || (sub.status === 'past_due' && sub.retry?.nextAttemptAt && new Date(sub.retry.nextAttemptAt) <= now);

/**
 * Charge one subscription's saved card for its next month, if it is due.
 * → 'charged' | 'declined' | 'pending' | 'unknown' | 'skipped' | <reason>
 */
const chargeOne = async (subId, now = new Date()) => {
    const claimed = await Subscription.findOneAndUpdate(
        { _id: subId, status: { $in: ['active', 'past_due'] }, cancelAtPeriodEnd: { $ne: true }, $or: [{ chargingAt: null }, { chargingAt: { $lt: new Date(now.getTime() - CLAIM_MS) } }] },
        { $set: { chargingAt: now } },
        { new: true },
    ).select('+vaultId').lean();
    if (!claimed) return 'skipped';
    try {
        if (!isDue(claimed, now)) return 'not_due';

        // A monthly payment still open: find out what happened to it first.
        const open = await SubscriptionPayment.findOne({ subscription: claimed._id, kind: 'renewal', status: { $in: OPEN } });
        if (open) {
            if (open.payRequestId) {
                const after = await billing.syncCheckout(open, 'query');
                return after?.status === 'paid' ? 'charged' : 'pending';
            }
            if (!open.flagged) {
                await SubscriptionPayment.updateOne({ _id: open._id }, { $set: { flagged: true, flagReason: 'Outcome unknown: PayGate gave no answer to the charge. Check it at PayGate before anything is charged again.' } });
                alertSafe('Plan renewal outcome unknown', `Subscription payment ${open._id}: no answer from PayGate. The card may have been charged; renewals for this business are held until it is resolved.`);
            }
            return 'unknown';
        }
        // The owner is paying with a new card right now: that pays the month.
        const cardSession = await SubscriptionPayment.exists({ subscription: claimed._id, kind: 'card', status: { $in: OPEN }, createdAt: { $gt: new Date(now.getTime() - billing.CARD_SESSION_MS) } });
        if (cardSession) return 'card_session';

        let amountCents = subs.describe(claimed, now).nextPriceCents;
        // A rise the owner was not told about 14 days ahead: this month is at the old price.
        const { last } = prices(claimed);
        if (last != null && amountCents > last && !riseToldInTime(claimed)) {
            logger.warn({ subscriptionId: String(claimed._id) }, 'Price rise not notified in time — charging the previous price this month');
            amountCents = last;
        }
        if (!Number.isInteger(amountCents) || amountCents <= 0) {
            logger.warn({ subscriptionId: String(claimed._id) }, 'A plan renewal has nothing to charge — skipped');
            return 'no_price';
        }
        const attempt = claimed.status === 'past_due' ? (claimed.retry?.attempts || 0) + 1 : 1;
        const payment = await SubscriptionPayment.create({
            subscription: claimed._id,
            provider: claimed.provider,
            kind: 'renewal',
            terminal: billing.RECURRING_TERMINAL,
            amountCents,
            currency: 'NAD',
            reference: billing.newReference(),
            periodStart: claimed.paidThrough,
            prevPaidThrough: claimed.paidThrough,
            attempt,
            statusHistory: [historyEntry('initiated', 'charge')],
        });

        // No saved card (a first payment PayGate returned no card for): a failed try.
        if (!claimed.vaultId) {
            const failed = await SubscriptionPayment.findOneAndUpdate(
                { _id: payment._id },
                { $set: { status: 'failed', resultDesc: 'No saved card' }, $push: { statusHistory: historyEntry('failed', 'charge', 'no saved card') } },
                { new: true },
            );
            await recordFinance({ action: 'subscription.payment_failed', amountCents, provider: claimed.provider, reference: payment.reference, details: { source: 'charge', kind: 'renewal', status: 'failed', attempt, note: 'no saved card' } });
            await billing.applyRenewalFailed(failed, now);
            return 'declined';
        }

        // A money action that cannot be recorded must not go ahead.
        try {
            await recordFinance({ action: 'subscription.renewal_start', amountCents, provider: claimed.provider, reference: payment.reference, details: { subscription: String(claimed._id), attempt, periodStart: claimed.paidThrough } });
        } catch (err) {
            await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { status: 'failed', resultDesc: 'Not started: the audit entry could not be written' }, $push: { statusHistory: historyEntry('failed', 'charge', 'audit') } });
            throw err;
        }

        const owner = await User.findById(claimed.provider).select('name email').lean();
        let res;
        try {
            res = await paygate.chargeVault({
                vaultId: claimed.vaultId,
                reference: payment.reference,
                amountCents,
                currency: 'NAD',
                customer: { email: owner?.email || '' },
                terminal: billing.RECURRING_TERMINAL,
            });
        } catch (err) {
            if (err.code === 'NETWORK') {
                // The request may have reached PayGate: never charge again blind.
                await SubscriptionPayment.updateOne({ _id: payment._id }, { $set: { flagged: true, flagReason: 'Outcome unknown: PayGate could not be reached during the charge. Check it at PayGate before anything is charged again.' } });
                alertSafe('Plan renewal outcome unknown', `Subscription payment ${payment._id}: PayGate could not be reached mid-charge. Renewals for this business are held until it is resolved.`);
                return 'unknown';
            }
            // Refused before anything was sent (not configured, bad amount, no card).
            res = { ok: false, error: { code: err.code || 'ERROR', message: err.message } };
        }
        if (!res.ok) {
            // PayGate answered, but not with a transaction: nothing was charged.
            // Counted as a failed try, so a card PayGate will not take is not
            // tried every hour; the team is told.
            const failed = await SubscriptionPayment.findOneAndUpdate(
                { _id: payment._id, status: 'initiated' },
                { $set: { status: 'failed', resultCode: res.error?.resultCode ? String(res.error.resultCode).slice(0, 20) : null, resultDesc: String(res.error?.message || res.error?.code || 'Error').slice(0, 200) }, $push: { statusHistory: historyEntry('failed', 'charge', res.error?.code) } },
                { new: true },
            );
            if (failed) {
                await recordFinance({ action: 'subscription.payment_failed', amountCents, provider: claimed.provider, reference: payment.reference, details: { source: 'charge', kind: 'renewal', status: 'failed', attempt, error: res.error?.code || null } });
                await billing.applyRenewalFailed(failed, now);
            }
            alertSafe('Plan renewal refused by PayGate', `Subscription payment ${payment._id}: ${res.error?.code || 'error'}.`);
            return 'declined';
        }
        const after = await billing.applyQueryResult(payment, res, 'charge', now);
        if (after?.status === 'paid') return 'charged';
        if (after?.status === 'failed' || after?.status === 'cancelled') return 'declined';
        return 'pending';
    } finally {
        await Subscription.updateOne({ _id: claimed._id, chargingAt: now }, { $set: { chargingAt: null } });
    }
};

/** Every plan whose month is up, or whose next try is due. */
const chargeDue = async (now = new Date()) => {
    const due = await Subscription.find({
        $or: [
            { status: 'active', cancelAtPeriodEnd: { $ne: true }, paidThrough: { $lte: now } },
            { status: 'past_due', 'retry.nextAttemptAt': { $lte: now } },
        ],
    }).select('_id').limit(500).lean();
    const out = {};
    for (const { _id } of due) {
        try {
            const r = await chargeOne(_id, now);
            out[r] = (out[r] || 0) + 1;
        } catch (err) {
            out.error = (out.error || 0) + 1;
            logger.error({ subscriptionId: String(_id), err: err.message }, 'Plan renewal failed');
        }
    }
    return out;
};

/* ───────────────────────── the free trial ending ───────────────────────── */

const TRIAL_REMINDER_DAYS = [7, 1];

/** Remind owners whose free trial ends within 7 days, then within 1 day. */
const remindTrialsEnding = async (now = new Date()) => {
    const soon = await Subscription.find({
        status: 'trialing', trialEndsAt: { $gt: now, $lte: new Date(now.getTime() + TRIAL_REMINDER_DAYS[0] * DAY) },
    }).lean();
    let n = 0;
    for (const sub of soon) {
        const left = new Date(sub.trialEndsAt).getTime() - now.getTime();
        // The closest reminder due that has not been sent (a late one replaces the earlier).
        const due = [...TRIAL_REMINDER_DAYS].reverse().find((d) => left <= d * DAY && !sub.trialReminders?.[`d${d}SentAt`]);
        if (!due) continue;
        const set = {};
        for (const d of TRIAL_REMINDER_DAYS) if (d >= due) set[`trialReminders.d${d}SentAt`] = now;
        const r = await Subscription.updateOne({ _id: sub._id, status: 'trialing', [`trialReminders.d${due}SentAt`]: null }, { $set: set });
        if (!r.modifiedCount) continue;
        n += 1;
        const when = billing.day(sub.trialEndsAt);
        await billing.tellOwner(sub.provider, {
            message: `Your Bookplus free trial ends on ${when}. Add a card in Account, Your plan to keep taking online bookings.`,
            subject: due === 1 ? 'Your Bookplus free trial ends tomorrow' : 'Your Bookplus free trial ends in a week',
            heading: due === 1 ? 'your free trial ends tomorrow' : 'your free trial ends in a week',
            lines: [
                `Your Bookplus free trial ends on ${when}.`,
                'To keep taking online bookings, add a card in Account, Your plan and pay your first month. Adding it now does not shorten your trial: your first paid month starts when the trial ends.',
                'If no month is paid when the trial ends, clients cannot make new online bookings with you until it is. Your business stays listed and nothing is deleted.',
            ],
            rows: [['Trial ends', when], ['Then', `${billing.nad(subs.describe(sub, now).nextPriceCents)} a month`]],
        });
    }
    return n;
};

/** Trials that ended with no month paid: online bookings paused until the first month is paid. */
const pauseEndedTrials = async (now = new Date()) => {
    const ended = await Subscription.find({ status: { $in: ['trialing', 'trial_ended'] }, trialEndsAt: { $lte: now }, pausedAt: null, paidMonths: { $in: [0, null] } }).select('_id provider').lean();
    let n = 0;
    for (const sub of ended) {
        const r = await Subscription.updateOne(
            { _id: sub._id, status: { $in: ['trialing', 'trial_ended'] }, pausedAt: null },
            { $set: { status: 'trial_ended', pausedAt: now }, $push: { history: { at: now, event: 'trial_ended_paused', note: 'Trial ended with no month paid' } } },
        );
        if (!r.modifiedCount) continue;
        n += 1;
        await User.updateOne({ _id: sub.provider, billingPausedAt: null }, { $set: { billingPausedAt: now } });
        await recordFinance({ action: 'subscription.trial_ended_paused', provider: sub.provider, details: { subscription: String(sub._id) } });
        await billing.tellOwner(sub.provider, {
            message: 'Your Bookplus free trial has ended. Clients cannot make new online bookings with you until you add a card and pay your first month in Account, Your plan.',
            subject: 'Your Bookplus free trial has ended',
            heading: 'your free trial has ended',
            lines: [
                'Your Bookplus free trial has ended, and no month is paid yet.',
                'Clients cannot make new online bookings with you until you add a card and pay your first month in Account, Your plan. Your business stays listed, and your dashboard, calendar, clients and booking history are kept; you can still add bookings to your calendar yourself.',
            ],
        });
    }
    return n;
};

/* ───────────────────────── pausing, ending ───────────────────────── */

/** Past due for the whole 7 days: pause the plan (and the listing). */
const pauseOverdue = async (now = new Date()) => {
    const overdue = await Subscription.find({ status: 'past_due', 'retry.graceEndsAt': { $lte: now }, chargingAt: null }).select('_id provider').lean();
    let n = 0;
    for (const sub of overdue) {
        // Never while a payment for it could still be going through.
        if (await SubscriptionPayment.exists({ subscription: sub._id, status: { $in: OPEN }, createdAt: { $gt: new Date(now.getTime() - billing.CARD_SESSION_MS) } })) continue;
        if (await SubscriptionPayment.exists({ subscription: sub._id, kind: 'renewal', status: { $in: OPEN } })) continue;
        const r = await Subscription.updateOne(
            { _id: sub._id, status: 'past_due', 'retry.graceEndsAt': { $lte: now }, chargingAt: null },
            { $set: { status: 'paused', pausedAt: now, 'retry.nextAttemptAt': null }, $push: { history: { at: now, event: 'paused', note: 'Unpaid 7 days after the payment failed' } } },
        );
        if (!r.modifiedCount) continue;
        n += 1;
        await User.updateOne({ _id: sub.provider }, { $set: { billingPausedAt: now } });
        await recordFinance({ action: 'subscription.paused', provider: sub.provider, details: { subscription: String(sub._id) } });
        await billing.tellOwner(sub.provider, {
            message: 'Your Bookplus plan is paused because this month is unpaid. Clients cannot make new online bookings until you pay with a card in Account, Your plan.',
            subject: 'Your Bookplus plan is paused',
            heading: 'your plan is paused',
            lines: [
                'Your Bookplus plan is paused because this month is still unpaid, 7 days after the payment from your saved card did not go through.',
                'Clients cannot make new online bookings. Your business stays listed, and your dashboard, calendar, clients and booking history are kept; you can still add bookings to your calendar yourself.',
                'Pay with a card in Account, Your plan and online bookings are back on straight away.',
            ],
        });
    }
    return n;
};

/**
 * End a plan now: nothing more is charged, the saved card is deleted at
 * PayGate. Clients cannot make new online bookings (a paused plan stays
 * paused) until a new plan is paid for.
 */
const endPlan = async (subId, { reason = 'plan_ended', actor = null, now = new Date(), note = '' } = {}) => {
    const sub = await Subscription.findOneAndUpdate(
        { _id: subId, status: { $in: ['active', 'past_due', 'paused'] }, chargingAt: null },
        {
            $set: { status: 'cancelled', endedAt: now, pausedAt: now, cancelAtPeriodEnd: false, vaultId: null, 'retry.nextAttemptAt': null, card: { brand: null, last4: null, expMonth: null, expYear: null, savedAt: null } },
            $push: { history: { at: now, event: 'ended', by: actor?._id || null, note: note || reason } },
        },
    ).select('+vaultId').lean(); // the document BEFORE the update: it still has the token
    if (!sub) return false;
    // No plan: clients cannot make new online bookings until one is paid for again.
    if (reason !== 'account_closed') await User.updateOne({ _id: sub.provider, billingPausedAt: null }, { $set: { billingPausedAt: now } });
    await billing.queueVaultDeletion({ provider: sub.provider, subscription: sub._id, vaultId: sub.vaultId, last4: sub.card?.last4, reason: reason === 'account_closed' ? 'account_closed' : 'plan_ended' });
    await recordFinance({ actor, action: 'subscription.ended', provider: sub.provider, reason: note, details: { subscription: String(sub._id), reason, from: sub.status, paidThrough: sub.paidThrough || null } });
    return true;
};

/** Cancelled plans whose paid month is over. */
const endCancelled = async (now = new Date()) => {
    const done = await Subscription.find({ status: 'active', cancelAtPeriodEnd: true, paidThrough: { $lte: now } }).select('_id provider paidThrough').lean();
    let n = 0;
    for (const sub of done) {
        if (await endPlan(sub._id, { reason: 'plan_ended', now, note: 'Cancelled by the owner; the paid month is over' })) {
            n += 1;
            await billing.tellOwner(sub.provider, {
                message: 'Your Bookplus plan has ended, as you asked. Your card will not be charged again, and we have asked PayGate to delete it.',
                subject: 'Your Bookplus plan has ended',
                heading: 'your plan has ended',
                lines: [
                    'Your Bookplus plan has ended at the end of the month you paid for, as you asked. Your card will not be charged again, and we have asked PayGate to delete it.',
                    'Clients cannot make new online bookings with you until you start the plan again in Account, Your plan; your business stays listed and nothing is deleted.',
                ],
            });
        }
    }
    return n;
};

/* ───────────────────────── deleting saved cards ───────────────────────── */

const deleteReady = () => paygate.wireReady('deleteVault') && paygate.isConfigured(billing.TERMINAL);

/** Ask PayGate to delete the saved cards waiting in the queue. */
const runVaultDeletions = async (now = new Date()) => {
    if (!deleteReady()) return 0;
    const queue = await VaultDeletion.find({ status: 'pending', nextAttemptAt: { $lte: now } }).select('+vaultId').limit(100);
    let n = 0;
    for (const d of queue) {
        let r;
        try {
            r = d.vaultId ? await paygate.deleteVault({ vaultId: d.vaultId, terminal: billing.TERMINAL }) : { ok: true };
        } catch (err) {
            r = { ok: false, error: { code: err.code || 'ERROR', message: err.message } };
        }
        if (r.ok) {
            await VaultDeletion.updateOne({ _id: d._id, status: 'pending' }, { $set: { status: 'done', doneAt: now, vaultId: null, lastError: null }, $inc: { attempts: 1 } });
            await recordFinance({ action: 'subscription.card_deleted', provider: d.provider, details: { reason: d.reason, last4: d.last4 || null } });
            n += 1;
        } else {
            const attempts = d.attempts + 1;
            const giveUp = attempts >= MAX_DELETE_ATTEMPTS;
            await VaultDeletion.updateOne({ _id: d._id }, {
                $set: {
                    status: giveUp ? 'failed' : 'pending',
                    lastError: String(r.error?.message || r.error?.code || 'error').slice(0, 200),
                    nextAttemptAt: new Date(now.getTime() + Math.min(24, 2 ** (attempts - 1)) * HOUR),
                },
                $inc: { attempts: 1 },
            });
            if (giveUp) alertSafe('Saved card not deleted at PayGate', `Vault deletion ${d._id} (${d.reason}) failed ${attempts} times; delete the card at PayGate by hand.`);
        }
    }
    return n;
};

/* ───────────────────────── the owner: cancel, keep ───────────────────────── */

/**
 * The owner cancels. Paid up: nothing more is charged and the plan ends at
 * the end of the paid month. A month unpaid (past due or paused): the plan
 * ends now. → { ok, endsAt? , ended? }
 */
const cancel = async (owner, now = new Date()) => {
    const sub = await subs.forProvider(owner, now);
    if (!subscriptionBillingEnabled()) throw new PlanError('Not available.', { status: 404, code: 'off' });
    if (sub.chargingAt || await SubscriptionPayment.exists({ subscription: sub._id, kind: 'renewal', status: { $in: OPEN } })) {
        throw new PlanError('Your monthly payment is being taken right now. Please try again in a few minutes.', { code: 'busy' });
    }
    if (sub.status === 'active') {
        if (sub.cancelAtPeriodEnd) throw new PlanError('Your plan is already cancelled.', { code: 'already_cancelling' });
        const r = await Subscription.updateOne(
            { _id: sub._id, status: 'active', cancelAtPeriodEnd: { $ne: true }, chargingAt: null },
            { $set: { cancelAtPeriodEnd: true, cancelRequestedAt: now }, $push: { history: { at: now, event: 'cancel_requested', by: owner._id } } },
        );
        if (!r.modifiedCount) throw new PlanError('Your plan changed meanwhile. Please reload the page.', { code: 'changed' });
        await recordFinance({ actor: owner, action: 'subscription.cancel', provider: owner._id, details: { subscription: String(sub._id), endsAt: sub.paidThrough } });
        await billing.tellOwner(owner._id, {
            message: `Your Bookplus plan is cancelled. Your card will not be charged again, and your plan stays active until ${billing.day(sub.paidThrough)}.`,
            subject: 'Your Bookplus plan is cancelled',
            heading: 'your plan is cancelled',
            lines: [
                `Your Bookplus plan is cancelled. Your card will not be charged again, and your plan stays active until ${billing.day(sub.paidThrough)}, the end of the month you paid for. After that, clients cannot make new online bookings with you until you start a plan again.`,
                'Changed your mind? Choose "Keep my plan" in Account, Your plan before then.',
            ],
        });
        return { ok: true, endsAt: sub.paidThrough };
    }
    if (sub.status === 'past_due' || sub.status === 'paused') {
        await recordFinance({ actor: owner, action: 'subscription.cancel', provider: owner._id, details: { subscription: String(sub._id), from: sub.status, endsAt: now } });
        const ended = await endPlan(sub._id, { reason: 'plan_ended', actor: owner, now, note: `Cancelled by the owner while ${sub.status === 'paused' ? 'paused' : 'a month was unpaid'}` });
        if (!ended) throw new PlanError('Your plan changed meanwhile. Please reload the page.', { code: 'changed' });
        return { ok: true, ended: true };
    }
    throw new PlanError('You have no paid plan to cancel.', { code: 'not_active' });
};

/** The owner keeps a plan they cancelled, before the paid month is over. */
const keep = async (owner, now = new Date()) => {
    if (!subscriptionBillingEnabled()) throw new PlanError('Not available.', { status: 404, code: 'off' });
    const sub = await subs.forProvider(owner, now);
    const r = await Subscription.updateOne(
        { _id: sub._id, status: 'active', cancelAtPeriodEnd: true, paidThrough: { $gt: now } },
        { $set: { cancelAtPeriodEnd: false, cancelRequestedAt: null }, $push: { history: { at: now, event: 'cancel_withdrawn', by: owner._id } } },
    );
    if (!r.modifiedCount) throw new PlanError('Your plan is not cancelled, or it has already ended.', { code: 'not_cancelling' });
    await recordFinance({ actor: owner, action: 'subscription.keep', provider: owner._id, details: { subscription: String(sub._id) } });
    return { ok: true };
};

/**
 * The owner closed their account: the plan ends now and the saved card is
 * deleted at PayGate. Runs whether or not the switch is on (a card saved
 * earlier is still deleted). Never throws: closing the account goes ahead.
 */
const onAccountClosed = async (providerId, now = new Date()) => {
    try {
        const sub = await Subscription.findOne({ provider: providerId }).select('+vaultId').lean();
        if (!sub) return false;
        if (['active', 'past_due', 'paused'].includes(sub.status)) {
            // A charge in flight finishes first; its claim lapses within CLAIM_MS.
            await Subscription.updateOne({ _id: sub._id, chargingAt: { $lt: new Date(now.getTime() - CLAIM_MS) } }, { $set: { chargingAt: null } });
            if (await endPlan(sub._id, { reason: 'account_closed', now, note: 'The account was closed' })) return true;
        }
        if (sub.vaultId) {
            await Subscription.updateOne({ _id: sub._id }, { $set: { vaultId: null } });
            await billing.queueVaultDeletion({ provider: providerId, subscription: sub._id, vaultId: sub.vaultId, last4: sub.card?.last4, reason: 'account_closed' });
        }
        return true;
    } catch (err) {
        logger.error({ err: err.message }, 'Ending the plan of a closed account failed');
        alertSafe('Plan of a closed account not ended', `Provider ${providerId}: ${err.message}. End the plan and delete the saved card by hand.`);
        return false;
    }
};

/* ───────────────────────── the job ───────────────────────── */

/** One pass: ends, charges, pauses, then the card deletion queue. */
const runBillingTick = async (now = new Date()) => {
    const out = { ended: 0, priceNotices: 0, charges: {}, paused: 0, trialReminders: 0, trialsEnded: 0, cardsDeleted: 0 };
    if (subscriptionBillingEnabled() && billing.cardsReady()) {
        out.ended = await endCancelled(now);
        out.priceNotices = await notifyPriceRises(now);
        out.charges = await chargeDue(now);
        out.paused = await pauseOverdue(now);
        out.trialReminders = await remindTrialsEnding(now);
        out.trialsEnded = await pauseEndedTrials(now);
    }
    out.cardsDeleted = await runVaultDeletions(now);
    return out;
};

const startRenewalJob = () => {
    cron.schedule('20 * * * *', () => withLock('subscription-billing-tick', 50 * 60 * 1000, async () => {
        try {
            const out = await runBillingTick();
            if (out.ended || out.priceNotices || out.paused || out.trialReminders || out.trialsEnded || out.cardsDeleted || Object.keys(out.charges).length) logger.info(out, 'Plan billing tick');
        } catch (err) {
            logger.error({ err: err.message }, 'Plan billing tick failed');
        }
    }));
    logger.info('Plan billing job scheduled (hourly at :20)');
};

module.exports = {
    PlanError, PRICE_NOTICE_DAYS, notifyPriceRises, chargeOne, chargeDue, pauseOverdue, remindTrialsEnding, pauseEndedTrials, endPlan, endCancelled, runVaultDeletions,
    cancel, keep, onAccountClosed, runBillingTick, startRenewalJob,
};
