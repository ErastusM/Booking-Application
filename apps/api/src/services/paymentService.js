/**
 * Online booking payments (PAYMENTS_ENABLED): the business's payment setting,
 * starting a PayGate session for a booking, applying PayGate's answer to our
 * records, refunds, the ledger of what Bookplus owes each business, and the
 * payment-hold sweeper.
 *
 * Rules that hold everywhere in this file:
 *   - Money is integer cents. A booking's price (N$, may have cents) becomes
 *     cents once, through toCents().
 *   - PayGate's callbacks are never believed on their own: every state change
 *     comes from a server-side Query (applyQueryResult).
 *   - Every transition is a findOneAndUpdate with a status precondition, and
 *     every ledger entry has a unique key — so a duplicate notify, a return and
 *     a notify racing each other, or two sweeper ticks, can never confirm a
 *     booking twice or credit a business twice.
 *   - Nothing logs a password, checksum, card detail or bank account.
 */
const crypto = require('crypto');
const cron = require('node-cron');
const mongoose = require('mongoose');
const pino = require('pino');
const Appointment = require('../models/Appointment');
const Payment = require('../models/Payment');
const LedgerEntry = require('../models/LedgerEntry');
const Payout = require('../models/Payout');
const User = require('../models/User');
const paygate = require('./paygate');
const { paymentsEnabled } = require('../constants/features');
const { primaryOrigin } = require('../utils/origins');
const { withLock, withBookingLock } = require('../utils/lock');
const { sendAlert } = require('../utils/alerts');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const ONLINE_CURRENCY = 'NAD';
const { SETTLED, OPEN } = Payment;
const MAX_ATTEMPTS_PER_BOOKING = 6;
// A payment PayGate says it is still processing (status 5) keeps its booking
// held this much past the hold before the sweeper gives up on it.
const PROCESSING_GRACE_MS = 10 * 60 * 1000;

/* ───────────────────────────── config ───────────────────────────── */

const holdMinutes = () => {
    const n = parseInt(process.env.PAYMENT_HOLD_MINUTES, 10);
    return Number.isFinite(n) && n >= 5 && n <= 120 ? n : 15;
};
const commissionBps = () => {
    const n = parseInt(process.env.PLATFORM_COMMISSION_BPS, 10);
    return Number.isFinite(n) && n >= 0 && n <= 10000 ? n : 0;
};
// Where PayGate posts back to: the public API origin.
const apiBase = () => String(process.env.PAYGATE_CALLBACK_BASE_URL || process.env.SERVER_URL || '').replace(/\/+$/, '');
const notifyUrl = () => `${apiBase()}/api/payments/paygate/notify`;
const returnUrl = () => `${apiBase()}/api/payments/paygate/return`;
// The customer app's result page. Always built from our own config — never
// from anything in a request.
const customerBase = () => String(process.env.CUSTOMER_APP_URL || primaryOrigin() || '').replace(/\/+$/, '');
const resultPageUrl = (reference) => `${customerBase()}/booking/payment?ref=${encodeURIComponent(reference || '')}`;

/* ───────────────────────────── money helpers ───────────────────────────── */

const toCents = (amount) => {
    const n = Number(amount);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const formatCents = (cents) => {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(Math.trunc(cents));
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
const commissionOn = (amountCents, bps) => Math.round((amountCents * (bps || 0)) / 10000);

// Our MerchantOrderId: 32 characters of randomness, unguessable, URL-safe.
const newReference = () => `BP${crypto.randomBytes(15).toString('hex').toUpperCase()}`;
const REFERENCE_RE = /^BP[0-9A-F]{30}$/;

/* ───────────────────────────── business setting ───────────────────────────── */

const MODES = ['at_appointment', 'deposit', 'full'];
const DEPOSIT_TYPES = ['percent', 'fixed'];

const settingsOf = (user) => {
    const s = user?.paymentSettings || {};
    return {
        mode: MODES.includes(s.mode) ? s.mode : 'at_appointment',
        depositType: DEPOSIT_TYPES.includes(s.depositType) ? s.depositType : 'percent',
        depositValue: Number.isFinite(s.depositValue) ? s.depositValue : null,
        updatedAt: s.updatedAt || null,
    };
};

/**
 * Validate a settings update. depositValue: percent → whole number 1–100;
 * fixed → whole number of cents > 0 (capped at the price when booked).
 * Returns { ok: true, value } or { ok: false, message }.
 */
const validateSettings = (body, current) => {
    const next = { ...current };
    if (body.mode !== undefined) {
        if (!MODES.includes(body.mode)) return { ok: false, message: 'mode must be at_appointment, deposit or full' };
        next.mode = body.mode;
    }
    if (body.depositType !== undefined) {
        if (!DEPOSIT_TYPES.includes(body.depositType)) return { ok: false, message: 'depositType must be percent or fixed' };
        next.depositType = body.depositType;
    }
    if (body.depositValue !== undefined) {
        next.depositValue = body.depositValue === null || body.depositValue === '' ? null : Number(body.depositValue);
    }
    if (next.mode === 'deposit') {
        const v = next.depositValue;
        if (!Number.isInteger(v)) {
            return { ok: false, message: next.depositType === 'percent' ? 'Deposit percent must be a whole number from 1 to 100' : 'Fixed deposit must be a whole number of cents' };
        }
        if (next.depositType === 'percent' && (v < 1 || v > 100)) return { ok: false, message: 'Deposit percent must be from 1 to 100' };
        if (next.depositType === 'fixed' && (v < 1 || v > 100000000)) return { ok: false, message: 'Fixed deposit must be more than N$0.00' };
    }
    return { ok: true, value: { mode: next.mode, depositType: next.depositType, depositValue: next.mode === 'deposit' ? next.depositValue : (Number.isInteger(next.depositValue) ? next.depositValue : null) } };
};

/**
 * What a client must pay online for a booking of `priceCents`, or null when
 * it is paid at the appointment (switch off, business doesn't ask, business
 * isn't in NAD, or nothing to charge).
 */
const planFor = ({ settings, currency, priceCents }) => {
    if (!paymentsEnabled()) return null;
    const s = settings || {};
    if (!['deposit', 'full'].includes(s.mode)) return null;
    if (String(currency || '').toUpperCase() !== ONLINE_CURRENCY) return null;
    if (!Number.isInteger(priceCents) || priceCents <= 0) return null;
    let amountCents = priceCents;
    let kind = 'full';
    if (s.mode === 'deposit') {
        kind = 'deposit';
        if (s.depositType === 'fixed') amountCents = Math.min(Math.max(0, s.depositValue || 0), priceCents);
        else amountCents = Math.round((priceCents * Math.min(100, Math.max(0, s.depositValue || 0))) / 100);
        if (amountCents >= priceCents) { amountCents = priceCents; }
    }
    if (amountCents <= 0) return null;
    return { kind, amountCents, currency: ONLINE_CURRENCY, priceCents };
};

/** The plan for a booking of `price` (N$) with this business. */
const planForBooking = async (providerId, price) => {
    if (!paymentsEnabled() || !providerId) return null;
    const provider = await User.findById(providerId).select('paymentSettings businessProfile.currency').lean();
    if (!provider) return null;
    return planFor({
        settings: settingsOf(provider),
        currency: provider.businessProfile?.currency || 'NAD',
        priceCents: toCents(price),
    });
};

/* ───────────────────────────── payout account ───────────────────────────── */

const digitsOnly = (v) => String(v == null ? '' : v).replace(/[\s-]/g, '');
const maskAccountNumber = (n) => {
    const d = digitsOnly(n);
    return d ? `•••• ${d.slice(-4)}` : null;
};
const validatePayoutAccount = (body) => {
    const accountHolder = String(body.accountHolder || '').trim();
    const bankName = String(body.bankName || '').trim();
    const branchCode = digitsOnly(body.branchCode);
    const accountNumber = digitsOnly(body.accountNumber);
    if (accountHolder.length < 2 || accountHolder.length > 100) return { ok: false, message: 'Enter the account holder’s name' };
    if (bankName.length < 2 || bankName.length > 100) return { ok: false, message: 'Enter the bank’s name' };
    if (!/^\d{3,10}$/.test(branchCode)) return { ok: false, message: 'Branch code must be 3 to 10 digits' };
    if (!/^\d{5,20}$/.test(accountNumber)) return { ok: false, message: 'Account number must be 5 to 20 digits' };
    return { ok: true, value: { accountHolder, bankName, branchCode, accountNumber, updatedAt: new Date() } };
};
const hasPayoutAccount = (acct) => !!(acct && acct.accountNumber && acct.bankName);
const publicPayoutAccount = (acct, { full = false } = {}) => {
    if (!hasPayoutAccount(acct)) return { hasAccount: false, accountHolder: null, bankName: null, branchCode: null, accountNumberMasked: null };
    return {
        hasAccount: true,
        accountHolder: acct.accountHolder,
        bankName: acct.bankName,
        branchCode: acct.branchCode,
        accountNumberMasked: maskAccountNumber(acct.accountNumber),
        ...(full ? { accountNumber: acct.accountNumber } : {}),
        updatedAt: acct.updatedAt || null,
    };
};

/* ───────────────────────────── ledger ───────────────────────────── */

// Idempotent insert: a duplicate key means this entry is already written.
const writeEntry = async (entry) => {
    try {
        await LedgerEntry.create(entry);
        return true;
    } catch (err) {
        if (err && err.code === 11000) return false;
        throw err;
    }
};

const creditPayment = async (payment) => {
    await writeEntry({
        provider: payment.provider, type: 'payment', amountCents: payment.amountCents, currency: payment.currency,
        payment: payment._id, appointment: payment.appointment, key: `payment:${payment._id}`,
    });
    const fee = commissionOn(payment.amountCents, payment.commissionBps);
    if (fee > 0) {
        await writeEntry({
            provider: payment.provider, type: 'commission', amountCents: -fee, currency: payment.currency,
            payment: payment._id, appointment: payment.appointment, commissionBps: payment.commissionBps,
            key: `commission:${payment._id}`,
        });
    }
};

const debitRefund = async (payment, refund) => {
    await writeEntry({
        provider: payment.provider, type: 'refund', amountCents: -refund.amountCents, currency: payment.currency,
        payment: payment._id, appointment: payment.appointment, note: refund.reason || '', createdBy: refund.by || null,
        key: `refund:${refund._id}`,
    });
    // The commission on the refunded part goes back to the business: a fully
    // refunded payment nets to zero for everyone.
    const fee = commissionOn(refund.amountCents, payment.commissionBps);
    if (fee > 0) {
        await writeEntry({
            provider: payment.provider, type: 'commission', amountCents: fee, currency: payment.currency,
            payment: payment._id, appointment: payment.appointment, commissionBps: payment.commissionBps,
            note: 'Commission returned on refund', key: `commission-refund:${refund._id}`,
        });
    }
};

const balanceOf = async (providerId) => {
    const [row] = await LedgerEntry.aggregate([
        { $match: { provider: new mongoose.Types.ObjectId(String(providerId)) } },
        { $group: { _id: null, cents: { $sum: '$amountCents' } } },
    ]);
    return row ? row.cents : 0;
};

// Start of the current month in Africa/Windhoek (UTC+2, no DST).
const WINDHOEK_OFFSET_MS = 2 * 60 * 60 * 1000;
const monthStart = (now = new Date()) => {
    const local = new Date(now.getTime() + WINDHOEK_OFFSET_MS);
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - WINDHOEK_OFFSET_MS);
};

const balanceSummary = async (providerId) => {
    const pid = new mongoose.Types.ObjectId(String(providerId));
    const since = monthStart();
    const [balanceOwedCents, monthRows, lastPayout, refundsPending] = await Promise.all([
        balanceOf(pid),
        LedgerEntry.aggregate([
            { $match: { provider: pid, createdAt: { $gte: since }, type: { $in: ['payment', 'payout'] } } },
            { $group: { _id: '$type', cents: { $sum: '$amountCents' } } },
        ]),
        Payout.findOne({ provider: pid }).sort({ paidAt: -1, _id: -1 }).lean(),
        Payment.aggregate([
            { $match: { provider: pid, refundingCents: { $gt: 0 } } },
            { $group: { _id: null, cents: { $sum: '$refundingCents' } } },
        ]),
    ]);
    const month = Object.fromEntries(monthRows.map((r) => [r._id, r.cents]));
    return {
        currency: ONLINE_CURRENCY,
        balanceOwedCents,
        paidOnlineThisMonthCents: month.payment || 0,
        paidOutThisMonthCents: Math.abs(month.payout || 0),
        refundsPendingCents: refundsPending[0]?.cents || 0,
        lastPayout: lastPayout
            ? { amountCents: lastPayout.amountCents, paidAt: lastPayout.paidAt, reference: lastPayout.reference || '' }
            : null,
    };
};

/* ───────────────────────────── notify payload hygiene ───────────────────────────── */

const NOTIFY_KEEP = new Set([
    'PAYGATE_ID', 'PAY_REQUEST_ID', 'REFERENCE', 'TRANSACTION_STATUS', 'RESULT_CODE', 'AUTH_CODE', 'CURRENCY',
    'AMOUNT', 'RESULT_DESC', 'TRANSACTION_ID', 'RISK_INDICATOR', 'PAY_METHOD', 'PAY_METHOD_DETAIL',
]);
/** Keep only known, non-sensitive notify fields; mask anything card-number-like. */
const sanitizeNotify = (pairs) => {
    const out = {};
    for (const [k, v] of pairs || []) {
        if (!NOTIFY_KEEP.has(k)) continue;
        out[k] = String(v == null ? '' : v).slice(0, 200).replace(/\d{12,19}/g, (d) => `••••${d.slice(-4)}`);
    }
    return out;
};

/* ───────────────────────────── state changes ───────────────────────────── */

const historyEntry = (status, source, note) => ({ status, at: new Date(), source, ...(note ? { note } : {}) });

const notifyAdminsSafe = async (message) => {
    try {
        const { notifyAdmins } = require('../utils/notificationhelper');
        await notifyAdmins(message, 'system', '/bkplus-command');
    } catch (_) { /* never block a payment path on a notice */ }
};

/**
 * Recompute a settled payment's status from its refunds.
 */
const refreshRefundStatus = async (paymentId) => {
    const p = await Payment.findById(paymentId);
    if (!p || !SETTLED.includes(p.status)) return p;
    let status = 'paid';
    if (p.refunds.some((r) => r.gatewayStatus !== 'done')) status = 'refund_pending';
    else if (p.refundedCents >= p.amountCents) status = 'refunded';
    else if (p.refundedCents > 0) status = 'partially_refunded';
    if (status !== p.status) {
        return Payment.findOneAndUpdate(
            { _id: p._id, status: p.status },
            { $set: { status }, $push: { statusHistory: historyEntry(status, 'refund') } },
            { new: true },
        ) || p;
    }
    return p;
};

/**
 * Send a reserved refund to PayGate (also the retry path for a failed one).
 * Never throws: a failure leaves the refund `failed` (still reserved) and the
 * payment `refund_pending`, visible and retryable.
 */
const executeRefund = async (paymentId, refundId) => {
    let payment = await Payment.findById(paymentId);
    const refund = payment?.refunds.id(refundId);
    if (!payment || !refund || refund.gatewayStatus === 'done') return { ok: !!refund, payment };
    await Payment.updateOne({ _id: payment._id, 'refunds._id': refund._id }, { $inc: { 'refunds.$.attempts': 1 } });
    let result;
    try {
        result = await paygate.refund({ transactionId: payment.transactionId, amountCents: refund.amountCents });
    } catch (err) {
        result = { ok: false, error: { code: err.code || 'ERROR', message: err.message } };
    }
    if (result.ok) {
        const done = await Payment.findOneAndUpdate(
            { _id: payment._id, refunds: { $elemMatch: { _id: refund._id, gatewayStatus: { $ne: 'done' } } } },
            {
                $set: {
                    'refunds.$.gatewayStatus': 'done',
                    'refunds.$.completedAt': new Date(),
                    'refunds.$.gatewayTransactionId': result.transactionId || null,
                    'refunds.$.resultCode': result.resultCode || null,
                    'refunds.$.error': null,
                },
                $inc: { refundedCents: refund.amountCents, refundingCents: -refund.amountCents },
            },
            { new: true },
        );
        if (done) {
            await debitRefund(done, refund);
            const refundedAll = done.refundedCents >= done.amountCents;
            await Appointment.updateOne(
                { _id: done.appointment },
                {
                    $inc: { amountRefundedOnlineCents: refund.amountCents },
                    ...(refundedAll && done.kind === 'full' ? { $set: { paymentStatus: 'refunded' } } : {}),
                },
            );
            payment = await refreshRefundStatus(done._id);
            logger.info({ paymentId: String(done._id), amountCents: refund.amountCents }, 'Refund completed');
        }
        return { ok: true, payment };
    }
    const message = String(result.error?.message || 'Refund failed').slice(0, 300);
    await Payment.updateOne(
        { _id: payment._id, 'refunds._id': refund._id },
        { $set: { 'refunds.$.gatewayStatus': 'failed', 'refunds.$.error': message, 'refunds.$.resultCode': result.error?.resultCode || null } },
    );
    payment = await refreshRefundStatus(payment._id);
    logger.warn({ paymentId: String(payment._id), code: result.error?.code }, 'Refund failed at PayGate — left refund_pending');
    notifyAdminsSafe(`Refund of N$${formatCents(refund.amountCents)} failed and is waiting to be retried (payment ${payment._id}).`);
    return { ok: false, payment, error: message };
};

/**
 * Reserve and send a refund. amountCents defaults to everything still
 * refundable. `trigger` marks automatic refunds; an automatic trigger runs at
 * most once per payment (so a repeated cancel can't refund twice).
 * Returns { ok, payment, refundId?, error?, code? }.
 */
const requestRefund = async ({ paymentId, amountCents, reason = '', by = null, trigger = 'manual' }) => {
    const current = await Payment.findById(paymentId);
    if (!current) return { ok: false, code: 'not_found', error: 'Payment not found' };
    if (!SETTLED.includes(current.status) || !current.transactionId) {
        return { ok: false, code: 'not_refundable', error: 'Only a paid payment can be refunded' };
    }
    const remaining = current.amountCents - current.refundedCents - current.refundingCents;
    const amt = amountCents === undefined || amountCents === null ? remaining : Number(amountCents);
    if (!Number.isInteger(amt) || amt <= 0) {
        return { ok: false, code: remaining <= 0 ? 'nothing_to_refund' : 'bad_amount', error: remaining <= 0 ? 'Nothing left to refund' : 'amountCents must be a whole number of cents above 0' };
    }
    const refundId = new mongoose.Types.ObjectId();
    const filter = {
        _id: current._id,
        status: { $in: SETTLED },
        $expr: { $gte: [{ $subtract: ['$amountCents', { $add: ['$refundedCents', '$refundingCents'] }] }, amt] },
    };
    if (trigger !== 'manual') filter['refunds.trigger'] = { $ne: trigger };
    const claimed = await Payment.findOneAndUpdate(
        filter,
        {
            $inc: { refundingCents: amt },
            $set: { status: 'refund_pending' },
            $push: {
                refunds: { _id: refundId, amountCents: amt, reason: String(reason || '').slice(0, 500), trigger, by, at: new Date() },
                statusHistory: historyEntry('refund_pending', 'refund', trigger),
            },
        },
        { new: true },
    );
    if (!claimed) {
        return { ok: false, code: 'exceeds_refundable', error: `At most N$${formatCents(Math.max(0, remaining))} can still be refunded` };
    }
    const out = await executeRefund(claimed._id, refundId);
    return { ...out, refundId };
};

/** Retry a failed refund. */
const retryRefund = async (paymentId, refundId) => {
    const p = await Payment.findById(paymentId);
    const r = p?.refunds.id(refundId);
    if (!r) return { ok: false, code: 'not_found', error: 'Refund not found' };
    if (r.gatewayStatus === 'done') return { ok: true, payment: p };
    return executeRefund(paymentId, refundId);
};

/** Refund whatever is still refundable on every paid attempt of a booking. */
const refundBooking = async (appointmentId, { trigger, reason, by = null }) => {
    const paid = await Payment.find({ appointment: appointmentId, status: { $in: SETTLED } }).select('_id');
    const results = [];
    for (const p of paid) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await requestRefund({ paymentId: p._id, reason, by, trigger }));
    }
    return results;
};

/**
 * A booking's payment hold is over without a confirmed payment: cancel it (the
 * slot frees up), close any open attempts, and offer the slot to the waiting
 * list, as any cancellation does. No notice to the business — for them this
 * booking never existed. Returns the cancelled appointment or null.
 */
const releaseHold = async (appointmentId, { reason = 'payment_timeout', paymentStatus = 'expired', source = 'sweep', by = null } = {}) => {
    const appt = await Appointment.findOneAndUpdate(
        { _id: appointmentId, status: 'pending_payment' },
        {
            $set: { status: 'cancelled', cancellationReason: reason },
            $push: { statusHistory: { status: 'cancelled', changedBy: by, changedAt: new Date() } },
        },
        { new: true },
    );
    if (!appt) return null;
    await Payment.updateMany(
        { appointment: appt._id, status: { $in: OPEN } },
        { $set: { status: paymentStatus }, $push: { statusHistory: historyEntry(paymentStatus, source, reason) } },
    );
    try {
        const { promoteFromWaitingList } = require('../utils/waitingListHelper');
        await promoteFromWaitingList(appt.service, appt.appointmentDate, appt.startTime, appt.endTime);
    } catch (err) { logger.error({ err: err.message }, 'Waitlist promotion after a released payment hold failed'); }
    return appt;
};

/**
 * A payment is settled: credit the business, confirm the booking (once) and
 * send the usual new-booking notices. If the booking was already released (or
 * another attempt confirmed it), the money goes straight back to the client.
 * Idempotent — safe to call any number of times for the same payment.
 */
const ensurePaidEffects = async (paymentId) => {
    const payment = await Payment.findById(paymentId);
    if (!payment || !SETTLED.includes(payment.status)) return;
    await creditPayment(payment);

    const confirmed = await Appointment.findOneAndUpdate(
        { _id: payment.appointment, status: 'pending_payment' },
        {
            $set: {
                status: 'confirmed',
                amountPaidOnlineCents: payment.amountCents,
                onlinePayment: payment._id,
                ...(payment.kind === 'full' ? { paymentStatus: 'paid' } : {}),
            },
            $unset: { paymentHoldExpiresAt: 1 },
            $push: { statusHistory: { status: 'confirmed', changedBy: null, changedAt: new Date() } },
        },
        { new: true },
    ).populate('service').populate('customer', 'name email');

    if (confirmed) {
        logger.info({ appointmentId: String(confirmed._id), paymentId: String(payment._id) }, 'Online payment confirmed a booking');
        const { announceNewBooking } = require('../utils/bookingNotices');
        const svc = confirmed.service || {};
        const bookingClient = confirmed.customer
            ? { _id: confirmed.customer._id, name: confirmed.customer.name, email: confirmed.customer.email }
            : { _id: null, name: confirmed.guestName, email: confirmed.guestEmail };
        setImmediate(() => announceNewBooking({
            appointment: confirmed,
            svc,
            bookingClient,
            clientLabel: bookingClient.name || 'A client',
            price: confirmed.totalPrice,
            appointmentDate: confirmed.appointmentDate,
            startTime: confirmed.startTime,
            endTime: confirmed.endTime,
            extraEmail: { paidOnline: payment.amountCents / 100, paymentKind: payment.kind },
        }));
        return;
    }

    // Not confirmed by us: either another attempt confirmed it, or the hold was
    // released (timeout / the client cancelled) before the money arrived.
    const appt = await Appointment.findById(payment.appointment).select('status onlinePayment').lean();
    if (appt && appt.onlinePayment && String(appt.onlinePayment) === String(payment._id)) return; // it's ours
    if (!appt || appt.status === 'cancelled' || (appt.onlinePayment && String(appt.onlinePayment) !== String(payment._id))) {
        logger.warn({ paymentId: String(payment._id) }, 'Payment arrived for a booking that is no longer held — refunding');
        await requestRefund({
            paymentId: payment._id,
            trigger: 'booking_released',
            reason: appt && appt.status === 'cancelled' ? 'The booking was released before the payment arrived' : 'Duplicate payment for a booking that was already paid',
        });
    }
};

const STATUS_FOR_CODE = {
    [paygate.TX.DECLINED]: 'failed',
    [paygate.TX.SETTLEMENT_VOIDED]: 'failed',
    [paygate.TX.CANCELLED]: 'cancelled',
    [paygate.TX.USER_CANCELLED]: 'cancelled',
};

/**
 * Apply a Query answer (paygate.query()'s shape) to a payment. The only place
 * a payment's gateway outcome is decided.
 */
const applyQueryResult = async (payment, q, source) => {
    const now = new Date();
    if (!q || !q.ok) {
        await Payment.updateOne({ _id: payment._id }, { $set: { lastQueriedAt: now } });
        return Payment.findById(payment._id);
    }
    const code = q.transactionStatusCode;
    const gatewayFields = {
        lastQueriedAt: now,
        transactionStatusCode: code,
        ...(q.transactionId ? { transactionId: q.transactionId } : {}),
        ...(q.resultCode ? { resultCode: q.resultCode } : {}),
        ...(q.resultDescription || q.transactionStatusDescription ? { resultDesc: String(q.resultDescription || q.transactionStatusDescription).slice(0, 200) } : {}),
        ...(q.authCode ? { authCode: q.authCode } : {}),
        ...(q.payMethod ? { payMethod: String(q.payMethod).slice(0, 40) } : {}),
    };

    if (code === paygate.TX.APPROVED) {
        const problems = [];
        if (!q.reference || q.reference !== payment.reference) problems.push('reference');
        if (q.amountCents !== payment.amountCents) problems.push('amount');
        if (!q.currency || String(q.currency).toUpperCase() !== payment.currency) problems.push('currency');
        if (problems.length) {
            const reason = `PayGate approved but ${problems.join(', ')} did not match`;
            await Payment.updateOne({ _id: payment._id }, { $set: { ...gatewayFields, flagged: true, flagReason: reason } });
            logger.error({ paymentId: String(payment._id), mismatch: problems }, 'Online payment mismatch — not confirmed');
            sendAlert('Online payment mismatch — booking NOT confirmed', `Payment ${payment._id}: ${reason}`).catch(() => {});
            notifyAdminsSafe(`Online payment ${payment._id} needs review: ${reason}. The booking was not confirmed.`);
            return Payment.findById(payment._id);
        }
        const claimed = await Payment.findOneAndUpdate(
            { _id: payment._id, status: { $in: [...OPEN, 'failed', 'cancelled', 'expired'] } },
            {
                $set: { ...gatewayFields, status: 'paid', paidAt: now, commissionBps: commissionBps() },
                $push: { statusHistory: historyEntry('paid', source) },
            },
            { new: true },
        );
        if (!claimed) await Payment.updateOne({ _id: payment._id }, { $set: { lastQueriedAt: now } });
        // Whoever claimed it — or a re-run after a crash between the claim and
        // the follow-up — makes sure the effects exist; they are idempotent.
        await ensurePaidEffects(payment._id);
        return Payment.findById(payment._id);
    }

    const next = STATUS_FOR_CODE[code] || (code === paygate.TX.RECEIVED ? 'pending' : null);
    if (next) {
        const from = next === 'pending' ? ['initiated'] : OPEN;
        const moved = await Payment.findOneAndUpdate(
            { _id: payment._id, status: { $in: from } },
            { $set: { ...gatewayFields, status: next }, $push: { statusHistory: historyEntry(next, source) } },
            { new: true },
        );
        if (moved) return moved;
    }
    await Payment.updateOne({ _id: payment._id }, { $set: { lastQueriedAt: now } });
    return Payment.findById(payment._id);
};

/** Ask PayGate for the truth about a payment and apply it. */
const syncPayment = async (payment, source = 'query') => {
    if (!payment || !payment.payRequestId) return payment;
    let q;
    try {
        q = await paygate.query({ payRequestId: payment.payRequestId });
    } catch (err) {
        logger.warn({ paymentId: String(payment._id), code: err.code }, 'PayGate query failed');
        q = { ok: false };
    }
    return applyQueryResult(payment, q, source);
};

/* ───────────────────────────── checkout ───────────────────────────── */

class PaymentStartError extends Error {
    constructor(message, code = 'payment_unavailable') { super(message); this.code = code; }
}

const splitName = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { firstName: 'Client', lastName: 'Client' };
    if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

/**
 * Create a Payment for a held booking and open a PayGate session for it.
 * Returns { payment, redirectUrl, fields } — the browser must POST `fields`
 * as a form to `redirectUrl`. Throws PaymentStartError (payment marked failed).
 */
const startSession = async ({ appointment, kind, amountCents, currency, payer }) => {
    const payment = await Payment.create({
        appointment: appointment._id,
        provider: appointment.provider,
        customer: payer.userId || null,
        guestEmail: payer.userId ? null : payer.email,
        guestName: payer.userId ? null : payer.name,
        kind,
        amountCents,
        currency,
        reference: newReference(),
        statusHistory: [historyEntry('initiated', 'initiate')],
    });
    let res;
    try {
        if (!paygate.isConfigured()) throw new paygate.PaygateError('Online payment is not configured', { code: 'NOT_CONFIGURED' });
        res = await paygate.initiate({
            reference: payment.reference,
            amountCents,
            currency,
            customer: { ...splitName(payer.name), email: payer.email },
            notifyUrl: notifyUrl(),
            returnUrl: returnUrl(),
        });
    } catch (err) {
        res = { ok: false, error: { code: err.code || 'ERROR', message: err.message } };
    }
    if (!res.ok) {
        await Payment.updateOne({ _id: payment._id }, {
            $set: { status: 'failed', resultCode: res.error?.resultCode || res.error?.code || null, resultDesc: String(res.error?.message || '').slice(0, 200) },
            $push: { statusHistory: historyEntry('failed', 'initiate', res.error?.code) },
        });
        logger.warn({ paymentId: String(payment._id), code: res.error?.code }, 'PayGate session could not be started');
        throw new PaymentStartError('Online payment is unavailable right now. Please try again in a few minutes.');
    }
    // Defence: PayGate must echo our own reference back.
    if (res.fields.REFERENCE && res.fields.REFERENCE !== payment.reference) {
        await Payment.updateOne({ _id: payment._id }, { $set: { status: 'failed', resultDesc: 'reference mismatch on initiate' } });
        throw new PaymentStartError('Online payment is unavailable right now. Please try again in a few minutes.');
    }
    const updated = await Payment.findByIdAndUpdate(payment._id, { $set: { payRequestId: res.payRequestId } }, { new: true });
    return { payment: updated, redirectUrl: res.redirectUrl, fields: res.fields };
};

/** The `payment` block the booking response carries for the client to pay. */
const checkoutPayload = ({ payment, redirectUrl, fields }, appointment) => ({
    reference: payment.reference,
    kind: payment.kind,
    amountCents: payment.amountCents,
    currency: payment.currency,
    holdExpiresAt: appointment.paymentHoldExpiresAt || null,
    redirectUrl,
    method: 'POST',
    fields,
});

/**
 * POST /api/payments/:reference/retry — a fresh PayGate session for a booking
 * that is still held. Returns { ok, payload } or { ok:false, status, code, message }.
 */
const retryCheckout = async (reference) => {
    const payment = await Payment.findOne({ reference });
    if (!payment) return { ok: false, status: 404, code: 'not_found', message: 'Payment not found' };
    // Something may already have gone through: ask first.
    const open = await Payment.find({ appointment: payment.appointment, status: { $in: OPEN }, payRequestId: { $exists: true } });
    for (const p of open) {
        // eslint-disable-next-line no-await-in-loop
        await syncPayment(p, 'retry');
    }
    const appt = await Appointment.findById(payment.appointment).populate('customer', 'name email');
    if (!appt || appt.status !== 'pending_payment') {
        return { ok: false, status: 409, code: appt?.status === 'confirmed' ? 'already_paid' : 'hold_released', message: appt?.status === 'confirmed' ? 'This booking is already paid.' : 'This booking is no longer held. Please book again.' };
    }
    if (!appt.paymentHoldExpiresAt || appt.paymentHoldExpiresAt.getTime() <= Date.now()) {
        return { ok: false, status: 409, code: 'hold_expired', message: 'The time to pay for this booking has run out. Please book again.' };
    }
    const attempts = await Payment.countDocuments({ appointment: appt._id });
    if (attempts >= MAX_ATTEMPTS_PER_BOOKING) {
        return { ok: false, status: 429, code: 'too_many_attempts', message: 'Too many payment attempts for this booking. Please book again.' };
    }
    // Close attempts still open — a newer one replaces them. (If one of them is
    // approved after all, it confirms the booking and any extra is refunded.)
    await Payment.updateMany(
        { appointment: appt._id, status: { $in: OPEN } },
        { $set: { status: 'cancelled' }, $push: { statusHistory: historyEntry('cancelled', 'retry', 'replaced by a new attempt') } },
    );
    const payer = appt.customer
        ? { userId: appt.customer._id, name: appt.customer.name, email: appt.customer.email }
        : { userId: null, name: appt.guestName, email: appt.guestEmail };
    try {
        const session = await startSession({
            appointment: appt, kind: payment.kind, amountCents: appt.amountDueOnlineCents || payment.amountCents,
            currency: appt.currency || payment.currency, payer,
        });
        return { ok: true, payload: checkoutPayload(session, appt) };
    } catch (err) {
        return { ok: false, status: 502, code: 'payment_unavailable', message: err.message };
    }
};

/* ───────────────────────────── cancellations ───────────────────────────── */

/**
 * Called after a booking is cancelled anywhere. Closes open payment attempts
 * and, when money was taken, refunds it under the cancellation rules:
 *   actor 'business' (owner, staff, admin, platform) → full refund of what was paid;
 *   actor 'client' → full refund when the business's cancellation window
 *   allowed it (`withinWindow`), otherwise none.
 * Never throws — a refund problem must not undo the cancellation; it is left
 * refund_pending (visible, retryable) instead.
 */
const onAppointmentCancelled = async (appointmentId, { actor = 'business', withinWindow = true, by = null } = {}) => {
    if (!appointmentId) return;
    try {
        await Payment.updateMany(
            { appointment: appointmentId, status: { $in: OPEN } },
            { $set: { status: 'cancelled' }, $push: { statusHistory: historyEntry('cancelled', 'cancel', actor) } },
        );
        const anyPaid = await Payment.exists({ appointment: appointmentId, status: { $in: SETTLED } });
        if (!anyPaid) return;
        if (actor === 'client' && !withinWindow) {
            logger.info({ appointmentId: String(appointmentId) }, 'Client cancelled after the deadline — no refund');
            return;
        }
        await refundBooking(appointmentId, {
            trigger: actor === 'client' ? 'client_cancelled' : 'business_cancelled',
            reason: actor === 'client' ? 'Cancelled by the client in time' : 'Cancelled by the business',
            by,
        });
    } catch (err) {
        logger.error({ err: err.message, appointmentId: String(appointmentId) }, 'Refund on cancellation failed');
    }
};

/* ───────────────────────────── hold sweeper ───────────────────────────── */

/**
 * Release every payment hold whose time ran out. PayGate is asked first about
 * any attempt still open, so a late approval wins and confirms the booking.
 * Returns { released, confirmed }.
 */
const sweepExpiredHolds = async (now = new Date()) => {
    let released = 0;
    let confirmed = 0;
    const expired = await Appointment.find({ status: 'pending_payment', paymentHoldExpiresAt: { $lte: now } })
        .select('_id paymentHoldExpiresAt').limit(200).lean();
    for (const a of expired) {
        try {
            const open = await Payment.find({ appointment: a._id, status: { $in: OPEN }, payRequestId: { $exists: true } });
            let stillProcessing = false;
            for (const p of open) {
                // eslint-disable-next-line no-await-in-loop
                const after = await syncPayment(p, 'sweep');
                if (after && after.status === 'pending') stillProcessing = true;
            }
            const fresh = await Appointment.findById(a._id).select('status').lean();
            if (!fresh || fresh.status !== 'pending_payment') { if (fresh?.status === 'confirmed') confirmed += 1; continue; }
            if (stillProcessing && now.getTime() - new Date(a.paymentHoldExpiresAt).getTime() < PROCESSING_GRACE_MS) continue;
            if (await releaseHold(a._id, { reason: 'payment_timeout', paymentStatus: 'expired', source: 'sweep' })) released += 1;
        } catch (err) {
            logger.error({ err: err.message, appointmentId: String(a._id) }, 'Payment hold sweep failed for a booking');
        }
    }
    return { released, confirmed };
};

const startPaymentHoldJob = () => {
    cron.schedule('* * * * *', () => withLock('payment-hold-sweep', 50 * 1000, async () => {
        if (!paymentsEnabled()) return;
        try {
            const r = await sweepExpiredHolds();
            if (r.released || r.confirmed) logger.info(r, 'Payment holds swept');
        } catch (err) {
            logger.error({ err: err.message }, 'Payment hold sweeper failed');
        }
    }));
    logger.info('Payment hold sweeper started (every minute)');
};

/* ───────────────────────────── payouts ───────────────────────────── */

/**
 * Record a payout Bookplus made to a business. Refuses more than the balance
 * owed, or a business without a payout account, unless the admin explicitly
 * overrides that check. Serialized per business so two admins can't overdraw.
 */
const recordPayout = async ({ providerId, amountCents, reference = '', note = '', paidAt, adminId, allowOverdraw = false, allowMissingAccount = false }) => {
    if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, status: 400, message: 'amountCents must be a whole number of cents above 0' };
    const provider = await User.findOne({ _id: providerId, role: 'provider' }).select('+payoutAccount name').lean();
    if (!provider) return { ok: false, status: 404, message: 'Business not found' };
    const hasAccount = hasPayoutAccount(provider.payoutAccount);
    if (!hasAccount && !allowMissingAccount) {
        return { ok: false, status: 409, code: 'payout_account_missing', message: 'This business has not added a payout bank account.' };
    }
    return withBookingLock(`payout:${providerId}`, async () => {
        const balance = await balanceOf(providerId);
        if (amountCents > balance && !allowOverdraw) {
            return { ok: false, status: 409, code: 'exceeds_balance', message: `The balance owed is N$${formatCents(balance)}.`, balanceOwedCents: balance };
        }
        const overrides = [];
        if (amountCents > balance) overrides.push('balance');
        if (!hasAccount) overrides.push('payout_account');
        const payout = await Payout.create({
            provider: providerId, amountCents, currency: ONLINE_CURRENCY,
            reference: String(reference || '').slice(0, 120), note: String(note || '').slice(0, 500),
            bankName: hasAccount ? provider.payoutAccount.bankName : null,
            accountNumberMasked: hasAccount ? maskAccountNumber(provider.payoutAccount.accountNumber) : null,
            overrides, paidAt: paidAt || new Date(), createdBy: adminId,
        });
        await writeEntry({
            provider: providerId, type: 'payout', amountCents: -amountCents, currency: ONLINE_CURRENCY,
            payout: payout._id, note: payout.reference, createdBy: adminId, key: `payout:${payout._id}`,
        });
        return { ok: true, payout, balanceOwedCents: balance - amountCents };
    });
};

module.exports = {
    ONLINE_CURRENCY, REFERENCE_RE,
    holdMinutes, commissionBps, notifyUrl, returnUrl, resultPageUrl,
    toCents, formatCents, newReference,
    settingsOf, validateSettings, planFor, planForBooking,
    maskAccountNumber, validatePayoutAccount, hasPayoutAccount, publicPayoutAccount,
    balanceOf, balanceSummary, monthStart, writeEntry,
    sanitizeNotify, applyQueryResult, syncPayment, ensurePaidEffects,
    PaymentStartError, startSession, checkoutPayload, retryCheckout,
    requestRefund, retryRefund, refundBooking, releaseHold, onAppointmentCancelled,
    sweepExpiredHolds, startPaymentHoldJob, recordPayout,
};
