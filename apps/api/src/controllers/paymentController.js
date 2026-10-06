/**
 * /api/payments — online booking payments (PAYMENTS_ENABLED; 404 while off).
 *
 * Who sees what (the owner rule): only the business OWNER (role provider) sees
 * or changes their business's money — payment setting, balance owed,
 * statement, payments, refunds, payout bank account. Team members (staff) see
 * none of it. Admins see every business and record payouts. Clients reach only
 * the public result-page endpoints, keyed by an unguessable reference.
 */
const mongoose = require('mongoose');
const pino = require('pino');
const Appointment = require('../models/Appointment');
const Payment = require('../models/Payment');
const LedgerEntry = require('../models/LedgerEntry');
const Payout = require('../models/Payout');
const User = require('../models/User');
const paygate = require('../services/paygate');
const payments = require('../services/paymentService');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const isId = (v) => mongoose.isValidObjectId(v) && String(new mongoose.Types.ObjectId(String(v))) === String(v);
const fail = (res, status, message, code) => res.status(status).json({ success: false, ...(code ? { code } : {}), message });
const pageOf = (q, max = 100) => {
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const limit = Math.min(max, Math.max(1, parseInt(q.limit, 10) || 25));
    return { page, limit, skip: (page - 1) * limit };
};
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// The business a request acts for: the owner's own; an admin names one.
const targetProviderId = (req) => {
    if (req.user.role === 'provider') return req.user._id;
    const id = req.query.providerId || req.body?.providerId;
    return isId(id) ? id : null;
};

/* ───────────────────────────── settings ───────────────────────────── */

const settingsPayload = (user) => {
    const currency = user.businessProfile?.currency || 'NAD';
    return {
        ...payments.settingsOf(user),
        currency,
        // Online payment is only offered to businesses that price in NAD.
        onlinePaymentAvailable: String(currency).toUpperCase() === payments.ONLINE_CURRENCY,
        holdMinutes: payments.holdMinutes(),
    };
};

// GET /api/payments/settings (owner; admin with ?providerId=)
exports.getSettings = async (req, res) => {
    try {
        const pid = targetProviderId(req);
        if (!pid) return fail(res, 400, 'providerId is required');
        const user = await User.findOne({ _id: pid, role: 'provider' }).select('paymentSettings businessProfile.currency').lean();
        if (!user) return fail(res, 404, 'Business not found');
        res.status(200).json({ success: true, data: settingsPayload(user) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// PUT /api/payments/settings { mode, depositType, depositValue } (owner; admin with providerId)
exports.updateSettings = async (req, res) => {
    try {
        const pid = targetProviderId(req);
        if (!pid) return fail(res, 400, 'providerId is required');
        const user = await User.findOne({ _id: pid, role: 'provider' });
        if (!user) return fail(res, 404, 'Business not found');
        const v = payments.validateSettings(req.body || {}, payments.settingsOf(user));
        if (!v.ok) return fail(res, 400, v.message, 'invalid_payment_settings');
        const currency = user.businessProfile?.currency || 'NAD';
        if (v.value.mode !== 'at_appointment' && String(currency).toUpperCase() !== payments.ONLINE_CURRENCY) {
            return fail(res, 400, 'Online payment is only available for businesses that price in Namibian Dollars (NAD).', 'currency_not_supported');
        }
        user.paymentSettings = { ...v.value, updatedAt: new Date(), updatedBy: req.user._id };
        await user.save();
        res.status(200).json({ success: true, message: 'Payment setting saved', data: settingsPayload(user) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// GET /api/payments/policy/:providerId?priceCents= — public: what a client
// will be asked to pay online at this business (for the booking page).
exports.getPolicy = async (req, res) => {
    try {
        if (!isId(req.params.providerId)) return fail(res, 404, 'Business not found');
        const user = await User.findOne({ _id: req.params.providerId, role: 'provider' }).select('paymentSettings businessProfile.currency').lean();
        if (!user) return fail(res, 404, 'Business not found');
        const s = settingsPayload(user);
        const priceCents = parseInt(req.query.priceCents, 10);
        const plan = Number.isFinite(priceCents)
            ? payments.planFor({ settings: s, currency: s.currency, priceCents })
            : null;
        res.status(200).json({
            success: true,
            data: {
                mode: s.onlinePaymentAvailable ? s.mode : 'at_appointment',
                depositType: s.depositType,
                depositValue: s.mode === 'deposit' ? s.depositValue : null,
                currency: s.currency,
                onlinePayment: s.onlinePaymentAvailable && s.mode !== 'at_appointment',
                holdMinutes: s.holdMinutes,
                ...(Number.isFinite(priceCents) ? { amountDueOnlineCents: plan ? plan.amountCents : 0, paymentKind: plan ? plan.kind : null } : {}),
            },
        });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

/* ───────────────────────────── payout account ───────────────────────────── */

// GET /api/payments/payout-account (owner) — number masked
exports.getPayoutAccount = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('+payoutAccount').lean();
        res.status(200).json({ success: true, data: payments.publicPayoutAccount(user?.payoutAccount) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// GET /api/payments/payout-account/edit (owner) — the full number, for the edit form only
exports.getPayoutAccountForEdit = async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const user = await User.findById(req.user._id).select('+payoutAccount').lean();
        res.status(200).json({ success: true, data: payments.publicPayoutAccount(user?.payoutAccount, { full: true }) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// PUT /api/payments/payout-account { accountHolder, bankName, branchCode, accountNumber } (owner)
exports.updatePayoutAccount = async (req, res) => {
    try {
        const v = payments.validatePayoutAccount(req.body || {});
        if (!v.ok) return fail(res, 400, v.message, 'invalid_payout_account');
        await User.updateOne({ _id: req.user._id, role: 'provider' }, { $set: { payoutAccount: v.value } });
        res.status(200).json({ success: true, message: 'Payout account saved', data: payments.publicPayoutAccount(v.value) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

/* ───────────────────────────── owner money views ───────────────────────────── */

// GET /api/payments/me/balance (owner)
exports.getMyBalance = async (req, res) => {
    try {
        res.status(200).json({ success: true, data: await payments.balanceSummary(req.user._id) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

const ENTRY_LABEL = { payment: 'Online payment', refund: 'Refund', commission: 'Bookplus commission', payout: 'Payout', adjustment: 'Adjustment' };

// Statement rows with a human description (client first name + service).
const describeEntries = async (entries) => {
    const apptIds = [...new Set(entries.map((e) => e.appointment && String(e.appointment)).filter(Boolean))];
    const appts = apptIds.length
        ? await Appointment.find({ _id: { $in: apptIds } }).select('customer guestName walkInName service appointmentDate')
            .populate('customer', 'name').populate('service', 'name').lean()
        : [];
    const byId = new Map(appts.map((a) => [String(a._id), a]));
    return entries.map((e) => {
        const a = e.appointment ? byId.get(String(e.appointment)) : null;
        const who = a ? firstName(a.customer?.name || a.guestName || a.walkInName) : '';
        const what = a?.service?.name || '';
        const detail = [who, what].filter(Boolean).join(' — ');
        const base = ENTRY_LABEL[e.type] || e.type;
        let description = detail ? `${base}: ${detail}` : base;
        if (e.type === 'payout' && e.note) description = `${base} (ref ${e.note})`;
        else if (e.type === 'adjustment' && e.note) description = `${base}: ${e.note}`;
        return {
            _id: e._id, date: e.createdAt, type: e.type, description,
            amountCents: e.amountCents, currency: e.currency,
            payment: e.payment || null, payout: e.payout || null, appointment: e.appointment || null,
        };
    });
};

// GET /api/payments/me/ledger?page&limit (owner) — newest first, each row with the balance after it
exports.getMyLedger = (req, res) => ledgerFor(req.user._id, req, res);

const ledgerFor = async (providerId, req, res) => {
    try {
        const pid = new mongoose.Types.ObjectId(String(providerId));
        const { page, limit, skip } = pageOf(req.query);
        const [total, balance, rows] = await Promise.all([
            LedgerEntry.countDocuments({ provider: pid }),
            payments.balanceOf(pid),
            LedgerEntry.find({ provider: pid }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        ]);
        // Balance after the newest row on this page = balance − every newer row.
        let newer = 0;
        if (skip > 0) {
            const [r] = await LedgerEntry.aggregate([
                { $match: { provider: pid } }, { $sort: { createdAt: -1, _id: -1 } }, { $limit: skip },
                { $group: { _id: null, cents: { $sum: '$amountCents' } } },
            ]);
            newer = r ? r.cents : 0;
        }
        let running = balance - newer;
        const described = await describeEntries(rows);
        const data = described.map((e) => {
            const row = { ...e, balanceAfterCents: running };
            running -= e.amountCents;
            return row;
        });
        res.status(200).json({ success: true, total, page, pages: Math.ceil(total / limit), balanceOwedCents: balance, data });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// A cell that can't be read as a formula by a spreadsheet (CSV injection):
// anything starting with = + - @ (or a tab/CR) gets a leading quote. A plain
// signed amount like -150.00 is a number, not a formula, and stays numeric so
// the statement still adds up in a spreadsheet.
const csvCell = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// GET /api/payments/me/statement.csv (owner) — oldest first, with running balance
exports.getMyStatementCsv = async (req, res) => {
    try {
        const pid = new mongoose.Types.ObjectId(String(req.user._id));
        const entries = await LedgerEntry.find({ provider: pid }).sort({ createdAt: 1, _id: 1 }).limit(20000).lean();
        const rows = await describeEntries(entries);
        let running = 0;
        const lines = [['Date', 'Type', 'Description', 'Amount (NAD)', 'Balance (NAD)'].map(csvCell).join(',')];
        for (const r of rows) {
            running += r.amountCents;
            lines.push([
                new Date(r.date).toISOString().slice(0, 10),
                ENTRY_LABEL[r.type] || r.type,
                r.description,
                payments.formatCents(r.amountCents),
                payments.formatCents(running),
            ].map(csvCell).join(','));
        }
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="bookplus-statement-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.set('Cache-Control', 'no-store');
        res.status(200).send(`${lines.join('\r\n')}\r\n`);
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// The payment fields the business and admin views show.
const paymentRow = (p) => ({
    _id: p._id,
    reference: p.reference,
    status: p.status,
    kind: p.kind,
    amountCents: p.amountCents,
    refundedCents: p.refundedCents || 0,
    refundingCents: p.refundingCents || 0,
    refundableCents: Payment.SETTLED.includes(p.status) ? Math.max(0, p.amountCents - (p.refundedCents || 0) - (p.refundingCents || 0)) : 0,
    currency: p.currency,
    commissionBps: p.commissionBps || 0,
    transactionId: p.transactionId || null,
    resultCode: p.resultCode || null,
    resultDesc: p.resultDesc || null,
    flagged: !!p.flagged,
    flagReason: p.flagReason || null,
    refunds: (p.refunds || []).map((r) => ({
        _id: r._id, amountCents: r.amountCents, reason: r.reason, trigger: r.trigger, at: r.at,
        gatewayStatus: r.gatewayStatus, error: r.error || null, attempts: r.attempts || 0, completedAt: r.completedAt || null,
    })),
    paidAt: p.paidAt || null,
    createdAt: p.createdAt,
    provider: p.provider && p.provider._id
        ? { _id: p.provider._id, name: p.provider.name, businessName: p.provider.businessProfile?.businessName || '' }
        : p.provider,
    appointment: p.appointment && p.appointment._id ? {
        _id: p.appointment._id,
        status: p.appointment.status,
        appointmentDate: p.appointment.appointmentDate,
        startTime: p.appointment.startTime,
        endTime: p.appointment.endTime,
        service: p.appointment.service?.name || null,
        clientName: p.appointment.customer?.name || p.appointment.guestName || p.appointment.walkInName || null,
    } : p.appointment,
});

const listPayments = async (filter, query) => {
    const { page, limit, skip } = pageOf(query);
    const [total, rows] = await Promise.all([
        Payment.countDocuments(filter),
        Payment.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit)
            .populate({ path: 'appointment', select: 'status appointmentDate startTime endTime service customer guestName walkInName', populate: [{ path: 'service', select: 'name' }, { path: 'customer', select: 'name' }] })
            .populate('provider', 'name businessProfile.businessName')
            .lean(),
    ]);
    return { total, page, pages: Math.ceil(total / limit), data: rows.map(paymentRow) };
};

const statusFilter = (q) => {
    const list = String(q.status || '').split(',').map((s) => s.trim()).filter((s) => Payment.STATUSES.includes(s));
    return list.length ? { status: { $in: list } } : {};
};
const dateFilter = (q) => {
    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    const w = {};
    if (YMD.test(q.from || '')) w.$gte = new Date(`${q.from}T00:00:00.000Z`);
    if (YMD.test(q.to || '')) w.$lte = new Date(`${q.to}T23:59:59.999Z`);
    return w.$gte || w.$lte ? { createdAt: w } : {};
};

// GET /api/payments/me/payments?status&from&to&page&limit (owner)
exports.getMyPayments = async (req, res) => {
    try {
        const filter = { provider: req.user._id, ...statusFilter(req.query), ...dateFilter(req.query) };
        res.status(200).json({ success: true, ...(await listPayments(filter, req.query)) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

/* ───────────────────────────── refunds ───────────────────────────── */

const loadOwnPayment = async (req, res) => {
    if (!isId(req.params.id)) { fail(res, 404, 'Payment not found'); return null; }
    const p = await Payment.findById(req.params.id);
    if (!p) { fail(res, 404, 'Payment not found'); return null; }
    if (req.user.role !== 'admin' && String(p.provider) !== String(req.user._id)) { fail(res, 404, 'Payment not found'); return null; }
    return p;
};

// POST /api/payments/:id/refund { amountCents?, reason } (owner / admin)
exports.refundPayment = async (req, res) => {
    try {
        const p = await loadOwnPayment(req, res);
        if (!p) return;
        const { amountCents, reason } = req.body || {};
        if (amountCents !== undefined && amountCents !== null && !Number.isInteger(amountCents)) {
            return fail(res, 400, 'amountCents must be a whole number of cents', 'bad_amount');
        }
        if (reason !== undefined && typeof reason !== 'string') return fail(res, 400, 'reason must be text');
        const r = await payments.requestRefund({ paymentId: p._id, amountCents, reason: (reason || '').trim(), by: req.user._id, trigger: 'manual' });
        // A validation refusal carries a code; a PayGate failure does not.
        if (!r.ok && r.code) {
            const status = r.code === 'not_found' ? 404 : ['exceeds_refundable', 'nothing_to_refund', 'not_refundable'].includes(r.code) ? 409 : 400;
            return fail(res, status, r.error, r.code);
        }
        const fresh = await Payment.findById(p._id).lean();
        if (!r.ok) {
            // The refund is recorded and reserved, but PayGate did not take it yet.
            return res.status(202).json({ success: false, code: 'refund_pending', message: 'The refund could not be sent to PayGate yet. It is saved and can be retried.', error: r.error, data: paymentRow(fresh) });
        }
        res.status(200).json({ success: true, message: 'Refund sent', data: paymentRow(fresh) });
    } catch (err) {
        logger.error({ err: err.message }, 'Refund request failed');
        fail(res, 500, 'Internal server error');
    }
};

// POST /api/payments/:id/refunds/:refundId/retry (owner / admin)
exports.retryRefund = async (req, res) => {
    try {
        const p = await loadOwnPayment(req, res);
        if (!p) return;
        if (!isId(req.params.refundId)) return fail(res, 404, 'Refund not found');
        const r = await payments.retryRefund(p._id, req.params.refundId);
        if (r.code === 'not_found') return fail(res, 404, r.error);
        const fresh = await Payment.findById(p._id).lean();
        if (!r.ok) return res.status(202).json({ success: false, code: 'refund_pending', message: 'PayGate still did not accept the refund.', error: r.error, data: paymentRow(fresh) });
        res.status(200).json({ success: true, message: 'Refund sent', data: paymentRow(fresh) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

/* ───────────────────────────── admin ───────────────────────────── */

// GET /api/payments/admin/balances — every business Bookplus owes (or has paid)
exports.adminBalances = async (req, res) => {
    try {
        const rows = await LedgerEntry.aggregate([
            { $group: { _id: '$provider', balanceOwedCents: { $sum: '$amountCents' }, lastEntryAt: { $max: '$createdAt' } } },
            { $sort: { balanceOwedCents: -1 } },
        ]);
        const ids = rows.map((r) => r._id);
        const [users, lastPayouts] = await Promise.all([
            User.find({ _id: { $in: ids } }).select('+payoutAccount name email businessProfile.businessName').lean(),
            Payout.aggregate([
                { $match: { provider: { $in: ids } } }, { $sort: { paidAt: -1 } },
                { $group: { _id: '$provider', amountCents: { $first: '$amountCents' }, paidAt: { $first: '$paidAt' }, reference: { $first: '$reference' } } },
            ]),
        ]);
        const u = new Map(users.map((x) => [String(x._id), x]));
        const lp = new Map(lastPayouts.map((x) => [String(x._id), x]));
        const data = rows.map((r) => {
            const user = u.get(String(r._id)) || {};
            const acct = user.payoutAccount;
            const last = lp.get(String(r._id));
            return {
                providerId: r._id,
                name: user.name || null,
                businessName: user.businessProfile?.businessName || '',
                email: user.email || null,
                balanceOwedCents: r.balanceOwedCents,
                currency: payments.ONLINE_CURRENCY,
                lastEntryAt: r.lastEntryAt,
                bankName: payments.hasPayoutAccount(acct) ? acct.bankName : null,
                accountNumberMasked: payments.hasPayoutAccount(acct) ? payments.maskAccountNumber(acct.accountNumber) : null,
                payoutAccountMissing: !payments.hasPayoutAccount(acct),
                lastPayout: last ? { amountCents: last.amountCents, paidAt: last.paidAt, reference: last.reference || '' } : null,
            };
        });
        const totalOwedCents = data.reduce((s, r) => s + Math.max(0, r.balanceOwedCents), 0);
        res.status(200).json({ success: true, totalOwedCents, data });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/payments/admin/payouts { providerId, amountCents, reference, note, paidAt?, allowOverdraw?, allowMissingAccount? }
exports.adminRecordPayout = async (req, res) => {
    try {
        const { providerId, amountCents, reference, note, paidAt, allowOverdraw, allowMissingAccount } = req.body || {};
        if (!isId(providerId)) return fail(res, 400, 'providerId is required');
        if (!Number.isInteger(amountCents) || amountCents <= 0) return fail(res, 400, 'amountCents must be a whole number of cents above 0', 'bad_amount');
        if (reference !== undefined && typeof reference !== 'string') return fail(res, 400, 'reference must be text');
        if (note !== undefined && typeof note !== 'string') return fail(res, 400, 'note must be text');
        let when;
        if (paidAt !== undefined && paidAt !== null) {
            when = new Date(paidAt);
            if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 60 * 1000) return fail(res, 400, 'paidAt must be a date that is not in the future');
        }
        const r = await payments.recordPayout({
            providerId, amountCents, reference: (reference || '').trim(), note: (note || '').trim(), paidAt: when,
            adminId: req.user._id, allowOverdraw: allowOverdraw === true, allowMissingAccount: allowMissingAccount === true,
        });
        if (!r.ok) return res.status(r.status).json({ success: false, code: r.code, message: r.message, ...(r.balanceOwedCents !== undefined ? { balanceOwedCents: r.balanceOwedCents } : {}) });
        res.status(201).json({ success: true, message: 'Payout recorded', data: r.payout, balanceOwedCents: r.balanceOwedCents });
    } catch (err) {
        if (err && err.code === 'BOOKING_BUSY') return fail(res, 409, 'Another payout for this business is being recorded. Try again.');
        fail(res, 500, 'Internal server error');
    }
};

// GET /api/payments/admin/payouts?providerId&page&limit
exports.adminListPayouts = async (req, res) => {
    try {
        const filter = isId(req.query.providerId) ? { provider: req.query.providerId } : {};
        const { page, limit, skip } = pageOf(req.query);
        const [total, data] = await Promise.all([
            Payout.countDocuments(filter),
            Payout.find(filter).sort({ paidAt: -1, _id: -1 }).skip(skip).limit(limit).populate('provider', 'name businessProfile.businessName').lean(),
        ]);
        res.status(200).json({ success: true, total, page, pages: Math.ceil(total / limit), data });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// GET /api/payments/admin/payments?status&providerId&reference&flagged&from&to&page&limit
exports.adminListPayments = async (req, res) => {
    try {
        const filter = { ...statusFilter(req.query), ...dateFilter(req.query) };
        if (isId(req.query.providerId)) filter.provider = req.query.providerId;
        if (typeof req.query.reference === 'string' && payments.REFERENCE_RE.test(req.query.reference)) filter.reference = req.query.reference;
        if (req.query.flagged === 'true') filter.flagged = true;
        res.status(200).json({ success: true, ...(await listPayments(filter, req.query)) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// GET /api/payments/admin/providers/:providerId/ledger — one business's statement
exports.adminProviderLedger = async (req, res) => {
    if (!isId(req.params.providerId)) return fail(res, 404, 'Business not found');
    return ledgerFor(req.params.providerId, req, res);
};

/* ───────────────────────────── public (result page) ───────────────────────────── */

// Only a little: what the result page shows. No client name, email or phone.
const publicStatus = async (payment) => {
    const appt = await Appointment.findById(payment.appointment)
        .select('status appointmentDate startTime endTime service provider paymentHoldExpiresAt totalPrice amountPaidOnlineCents')
        .populate('service', 'name').populate('provider', 'name businessProfile.businessName').lean();
    const held = appt?.status === 'pending_payment' && appt.paymentHoldExpiresAt && new Date(appt.paymentHoldExpiresAt).getTime() > Date.now();
    return {
        reference: payment.reference,
        status: payment.status,
        kind: payment.kind,
        amountCents: payment.amountCents,
        currency: payment.currency,
        canRetry: !!held && !Payment.SETTLED.includes(payment.status),
        appointment: appt ? {
            status: appt.status,
            appointmentDate: appt.appointmentDate,
            startTime: appt.startTime,
            endTime: appt.endTime,
            service: appt.service?.name || null,
            business: appt.provider?.businessProfile?.businessName || appt.provider?.name || null,
            holdExpiresAt: appt.status === 'pending_payment' ? appt.paymentHoldExpiresAt || null : null,
        } : null,
    };
};

// GET /api/payments/:reference/status — public, by unguessable reference
exports.getStatus = async (req, res) => {
    try {
        const ref = String(req.params.reference || '');
        if (!payments.REFERENCE_RE.test(ref)) return fail(res, 404, 'Payment not found');
        let payment = await Payment.findOne({ reference: ref });
        if (!payment) return fail(res, 404, 'Payment not found');
        // Still open: ask PayGate (throttled), so the result page never depends
        // on a callback having arrived.
        if (Payment.OPEN.includes(payment.status) && payment.payRequestId
            && (!payment.lastQueriedAt || Date.now() - payment.lastQueriedAt.getTime() > 5000)) {
            payment = await payments.syncPayment(payment, 'query');
        }
        res.set('Cache-Control', 'no-store');
        res.status(200).json({ success: true, data: await publicStatus(payment) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/payments/:reference/retry — public: a new PayGate session for a still-held booking
exports.retry = async (req, res) => {
    try {
        const ref = String(req.params.reference || '');
        if (!payments.REFERENCE_RE.test(ref)) return fail(res, 404, 'Payment not found');
        const r = await payments.retryCheckout(ref);
        if (!r.ok) return fail(res, r.status, r.message, r.code);
        res.status(201).json({ success: true, payment: r.payload });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

/* ───────────────────────────── PayGate callbacks ───────────────────────────── */

// The urlencoded body as ordered [name, value] pairs (the checksum is over the
// values in the order PayGate posted them).
const orderedPairs = (req) => {
    if (typeof req.rawBody === 'string') return [...new URLSearchParams(req.rawBody).entries()];
    return Object.entries(req.body || {}).map(([k, v]) => [k, String(v)]);
};
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

// POST /api/payments/paygate/return — the client's browser, back from PayGate
exports.paygateReturn = async (req, res) => {
    let reference = '';
    try {
        const pairs = orderedPairs(req);
        const get = (k) => (pairs.find(([n]) => n === k) || [])[1] || '';
        const payRequestId = get('PAY_REQUEST_ID');
        if (ID_RE.test(payRequestId)) {
            const payment = await Payment.findOne({ payRequestId });
            if (payment) {
                reference = payment.reference;
                const { paygateId } = paygate.config();
                const valid = paygate.verifyReturnChecksum({
                    paygateId, payRequestId, transactionStatus: get('TRANSACTION_STATUS'), reference: payment.reference, checksum: get('CHECKSUM'),
                }) || paygate.verifyPostedChecksum(pairs);
                if (valid) await payments.syncPayment(payment, 'return');
                else logger.warn({ paymentId: String(payment._id) }, 'PayGate return checksum did not verify — not acting on it');
            }
        }
    } catch (err) {
        logger.error({ err: err.message }, 'PayGate return handling failed');
    }
    // Always to OUR result page — never a URL from the request.
    res.redirect(303, payments.resultPageUrl(reference));
};

// POST /api/payments/paygate/notify — PayGate's server, expects plain "OK"
exports.paygateNotify = async (req, res) => {
    const pairs = orderedPairs(req);
    if (!paygate.verifyPostedChecksum(pairs)) {
        logger.warn({ fields: pairs.map(([k]) => k).filter((k) => k !== 'CHECKSUM') }, 'PayGate notify with an invalid checksum — rejected');
        return res.status(400).type('text/plain').send('INVALID');
    }
    try {
        const get = (k) => (pairs.find(([n]) => n === k) || [])[1] || '';
        const payRequestId = get('PAY_REQUEST_ID');
        const payment = ID_RE.test(payRequestId) ? await Payment.findOne({ payRequestId }) : null;
        if (!payment) {
            logger.warn('PayGate notify for an unknown payment — acknowledged');
        } else if (get('REFERENCE') && get('REFERENCE') !== payment.reference) {
            logger.warn({ paymentId: String(payment._id) }, 'PayGate notify reference does not match — acknowledged, not acted on');
        } else {
            await Payment.updateOne({ _id: payment._id }, { $set: { lastNotify: { ...payments.sanitizeNotify(pairs), receivedAt: new Date() } } });
            await payments.syncPayment(payment, 'notify');
        }
    } catch (err) {
        // The sweeper and the result page re-check with PayGate, so a failure
        // here is recoverable — still acknowledge.
        logger.error({ err: err.message }, 'PayGate notify handling failed');
    }
    res.status(200).type('text/plain').send('OK');
};

// Exposed for the CSV-injection unit check.
exports.csvCellForTest = csvCell;
