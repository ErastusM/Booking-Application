/**
 * /api/admin/finance — Bookplus's day-to-day money work (payment
 * specification, sections 8 to 10), next to the controls in financeController:
 *
 *   payments   every online payment; the ones that need a look (stuck open,
 *              flagged, a refund PayGate did not take); "ask PayGate"
 *   payouts    who is due a payout, preparing a payout run, the bank file,
 *              then each payout paid or returned by the bank
 *   disputes   card chargebacks and "the service was not provided"
 *              complaints: deadline, notes, private evidence, and how it
 *              ended (refund the client, or recover a lost chargeback from
 *              the business, both through second-person approval)
 *
 * Same gate as the rest of /api/admin/finance (two-step sign-in, finance
 * role). Every money action is written to the financial audit log.
 */
const mongoose = require('mongoose');
const pino = require('pino');
const Payment = require('../models/Payment');
const Payout = require('../models/Payout');
const User = require('../models/User');
const Dispute = require('../models/Dispute');
const FinanceRequest = require('../models/FinanceRequest');
const pricing = require('../services/pricing');
const payments = require('../services/paymentService');
const cloudinary = require('../utils/cloudinary');
const { recordFinance } = require('../utils/financeAudit');
const { createNotification } = require('../utils/notificationhelper');
const { listPayments, paymentRow, csvCell } = require('./paymentController')._shared;
const finance = require('./financeController');
const OperatingCost = require('../models/OperatingCost');
const financeDashboard = require('../services/financeDashboard');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const money = (cents) => `N$${(cents / 100).toFixed(2)}`;
// A populated user (not just its id: an ObjectId has an `_id` too).
const populated = (v) => !!v && typeof v === 'object' && !(v instanceof mongoose.Types.ObjectId);
const businessOf = (u) => (populated(u) ? { _id: u._id, name: u.name, businessName: u.businessProfile?.businessName || '' } : u);

/* ───────────────────────────── payments ───────────────────────────── */

// An open payment PayGate should have settled by now.
const STUCK_MINUTES = 15;

// GET /api/admin/finance/payments?view=attention|all&status&reference&providerId&page&limit
exports.listPayments = async (req, res) => {
    try {
        const filter = {};
        if (req.query.view === 'attention') {
            filter.$or = [
                { status: { $in: Payment.OPEN }, createdAt: { $lt: new Date(Date.now() - STUCK_MINUTES * 60 * 1000) } },
                { flagged: true },
                { status: 'refund_pending' },
            ];
        } else {
            const list = String(req.query.status || '').split(',').filter((s) => Payment.STATUSES.includes(s));
            if (list.length) filter.status = { $in: list };
        }
        if (typeof req.query.reference === 'string' && payments.REFERENCE_RE.test(req.query.reference.trim())) filter.reference = req.query.reference.trim();
        if (isId(req.query.providerId)) filter.provider = req.query.providerId;
        res.json({ success: true, ...(await listPayments(filter, req.query)) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

const loadPayment = async (id) => (isId(id) ? Payment.findById(id) : null);
const freshRow = async (id) => {
    const r = await listPayments({ _id: id }, {});
    return r.data[0] || null;
};

// POST /api/admin/finance/payments/:id/sync — ask PayGate what happened
exports.syncPayment = async (req, res) => {
    try {
        const p = await loadPayment(req.params.id);
        if (!p) return fail(res, 404, 'Payment not found');
        if (!p.payRequestId) return fail(res, 409, 'This payment never reached PayGate, so there is nothing to ask.', 'not_at_gateway');
        const before = p.status;
        const after = await payments.syncPayment(p, 'query');
        // Idempotent: repairs a paid payment whose booking or ledger credit was missed.
        if (after && Payment.SETTLED.includes(after.status)) await payments.ensurePaidEffects(after._id);
        await recordFinance({
            actor: req.user, action: 'payment.sync', amountCents: p.amountCents, provider: p.provider, appointment: p.appointment,
            payment: p._id, reference: p.reference, details: { before, after: after?.status || before },
        });
        res.json({
            success: true,
            message: after?.status === before ? `PayGate says it is still ${before.replace('_', ' ')}.` : `Updated: ${before.replace('_', ' ')} → ${after.status.replace('_', ' ')}.`,
            data: await freshRow(p._id),
        });
    } catch (err) {
        logger.error({ err: err.message }, 'payment sync failed');
        fail(res, 500, 'Internal server error');
    }
};

// POST /api/admin/finance/payments/:id/refunds/:refundId/retry — send a stuck refund again
exports.retryRefund = async (req, res) => {
    try {
        const p = await loadPayment(req.params.id);
        if (!p) return fail(res, 404, 'Payment not found');
        if (!isId(req.params.refundId)) return fail(res, 404, 'Refund not found');
        const r = await payments.retryRefund(p._id, req.params.refundId);
        if (r.code === 'not_found') return fail(res, 404, r.error);
        await recordFinance({
            actor: req.user, action: r.ok ? 'refund.retry' : 'refund.retry_fail', provider: p.provider, payment: p._id,
            reference: p.reference, details: { refund: req.params.refundId, error: r.ok ? null : r.error || null },
        });
        res.status(r.ok ? 200 : 202).json({ success: r.ok, message: r.ok ? 'Refund sent' : 'PayGate still did not take the refund.', data: await freshRow(p._id) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

/* ───────────────────────────── payouts ───────────────────────────── */

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The next payout day on the schedule (weekly/biweekly: the weekday; monthly: the 1st). */
const nextRunDate = (schedule, now = new Date()) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (schedule.frequency === 'monthly') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (d.getUTCDate() === 1 ? 0 : 1), 1));
    const wd = Number.isInteger(schedule.weekday) ? schedule.weekday : 5;
    d.setUTCDate(d.getUTCDate() + ((wd - d.getUTCDay() + 7) % 7));
    return d;
};

const payoutRow = (p) => ({
    _id: p._id,
    status: p.status,
    amountCents: p.amountCents,
    currency: p.currency,
    ourReference: p.ourReference || null,
    reference: p.reference || '',
    accountHolder: p.accountHolder || null,
    bankName: p.bankName || null,
    accountNumberMasked: p.accountNumberMasked || null,
    failureReason: p.failureReason || null,
    preparedAt: p.createdAt,
    paidAt: p.status === 'paid' ? p.paidAt : null,
    failedAt: p.failedAt || null,
    provider: businessOf(p.provider),
});

// GET /api/admin/finance/payouts/due
exports.payoutsDue = async (req, res) => {
    try {
        const due = await payments.payoutsDue();
        const schedule = { frequency: due.schedule.frequency || 'weekly', weekday: due.schedule.weekday ?? 5, minThresholdCents: due.minThresholdCents };
        res.json({
            success: true,
            schedule: { ...schedule, weekdayName: WEEKDAY[schedule.weekday], nextRunDate: nextRunDate(schedule) },
            totalPayableCents: due.data.filter((r) => r.payable).reduce((s, r) => s + r.amountCents, 0),
            data: due.data,
        });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/admin/finance/payouts/run { providerIds: [] } — prepare payouts (pending)
exports.preparePayouts = async (req, res) => {
    try {
        const ids = Array.isArray(req.body?.providerIds) ? req.body.providerIds.slice(0, 500) : [];
        if (!ids.length) return fail(res, 400, 'Choose the businesses to pay', 'nothing_chosen');
        const r = await payments.preparePayouts({ providerIds: ids, adminId: req.user._id });
        for (const p of r.created) {
            // eslint-disable-next-line no-await-in-loop
            await recordFinance({
                actor: req.user, action: 'payout.prepare', amountCents: p.amountCents, provider: p.provider,
                reference: p.ourReference, details: { payout: p._id },
            });
        }
        const total = r.created.reduce((s, p) => s + p.amountCents, 0);
        res.status(201).json({
            success: true,
            message: `${r.created.length} payout${r.created.length === 1 ? '' : 's'} prepared (${money(total)}).${r.skipped.length ? ` ${r.skipped.length} skipped.` : ''}`,
            data: { created: r.created.map(payoutRow), skipped: r.skipped },
        });
    } catch (err) {
        logger.error({ err: err.message }, 'payout run failed');
        fail(res, 500, 'Internal server error');
    }
};

// GET /api/admin/finance/payouts?status=pending|paid|failed&page&limit
exports.listPayouts = async (req, res) => {
    try {
        const filter = ['pending', 'paid', 'failed'].includes(req.query.status) ? { status: req.query.status } : {};
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const [total, rows] = await Promise.all([
            Payout.countDocuments(filter),
            Payout.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
                .populate('provider', 'name businessProfile.businessName').lean(),
        ]);
        res.json({ success: true, total, page, pages: Math.ceil(total / limit), data: rows.map(payoutRow) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/admin/finance/payouts/:id/paid { bankReference }
exports.payoutPaid = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Payout not found');
        const bankReference = text(req.body?.bankReference, 120);
        if (!bankReference) return fail(res, 400, 'Enter the bank\'s reference for the transfer', 'reference_required');
        const p = await payments.markPayoutPaid({ payoutId: req.params.id, bankReference });
        if (!p) return fail(res, 409, 'Only a payout on its way can be marked paid', 'not_pending');
        await recordFinance({ actor: req.user, action: 'payout.paid', amountCents: p.amountCents, provider: p.provider, reference: bankReference, details: { payout: p._id, ourReference: p.ourReference } });
        createNotification(p.provider, `Bookplus paid ${money(p.amountCents)} into your bank account (reference ${p.ourReference}).`, 'system', '/account?section=payments').catch(() => {});
        res.json({ success: true, message: 'Marked paid', data: payoutRow(p.toObject()) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/admin/finance/payouts/:id/failed { reason } — the bank returned it
exports.payoutFailed = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Payout not found');
        const reason = text(req.body?.reason, 500);
        if (!reason) return fail(res, 400, 'Say what the bank said', 'reason_required');
        const p = await payments.markPayoutFailed({ payoutId: req.params.id, reason, adminId: req.user._id });
        if (!p) return fail(res, 409, 'This payout was already returned', 'not_open');
        await recordFinance({ actor: req.user, action: 'payout.failed', amountCents: p.amountCents, provider: p.provider, reference: p.ourReference, reason, details: { payout: p._id } });
        createNotification(p.provider, `Your payout of ${money(p.amountCents)} could not be paid into your bank account: ${reason}. The money is back on your Bookplus balance. Please check your bank details.`, 'system', '/account?section=payments').catch(() => {});
        res.json({ success: true, message: 'Marked as returned; the money is back on the business\'s balance.', data: payoutRow(p.toObject()) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// GET /api/admin/finance/payouts/bank-file.csv — every payout on its way, with
// the full bank details to make the transfers (audited: it shows account numbers).
exports.bankFileCsv = async (req, res) => {
    try {
        const pending = await Payout.find({ status: 'pending' }).sort({ createdAt: 1 }).lean();
        const users = await User.find({ _id: { $in: pending.map((p) => p.provider) } })
            .select('+payoutAccount +paymentsApproval name businessProfile.businessName').lean();
        const byId = new Map(users.map((u) => [String(u._id), u]));
        const lines = [['Business', 'Account holder', 'Bank', 'Branch code', 'Account number', 'Amount (NAD)', 'Reference', 'Check'].map(csvCell).join(',')];
        let total = 0;
        for (const p of pending) {
            const u = byId.get(String(p.provider)) || {};
            const acct = u.payoutAccount || {};
            // The account changed after this payout was prepared: don't pay
            // into it until someone looks.
            const changed = u.paymentsApproval?.payoutAccountReviewNeeded
                || (acct.updatedAt && new Date(acct.updatedAt).getTime() > new Date(p.createdAt).getTime())
                || payments.maskAccountNumber(acct.accountNumber) !== p.accountNumberMasked;
            total += p.amountCents;
            lines.push([
                u.businessProfile?.businessName || u.name || '', acct.accountHolder || '', acct.bankName || '', acct.branchCode || '',
                changed ? '' : (acct.accountNumber || ''), payments.formatCents(p.amountCents), p.ourReference || '',
                changed ? 'Bank account changed after this payout was prepared: do not pay, check first' : 'OK',
            ].map(csvCell).join(','));
        }
        await recordFinance({ actor: req.user, action: 'payout.bank_file', amountCents: total, details: { payouts: pending.length } });
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename="bookplus-payouts-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.set('Cache-Control', 'no-store');
        res.status(200).send(`${lines.join('\r\n')}\r\n`);
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

/* ───────────────────────────── disputes ───────────────────────────── */

const KINDS = ['chargeback', 'service_not_provided', 'other'];

const disputeRow = (d) => ({
    _id: d._id,
    kind: d.kind,
    status: d.status,
    amountCents: d.amountCents,
    feeCents: d.feeCents || 0,
    currency: d.currency,
    caseReference: d.caseReference || '',
    deadlineAt: d.deadlineAt || null,
    summary: d.summary || '',
    recovery: d.recovery ? { status: d.recovery.status, amountCents: d.recovery.amountCents, request: d.recovery.request, at: d.recovery.at || null } : null,
    refundRequest: d.refundRequest || null,
    evidenceCount: (d.evidence || []).length,
    outcomeNote: d.outcomeNote || '',
    createdAt: d.createdAt,
    closedAt: d.closedAt || null,
    provider: businessOf(d.provider),
});

const populateDispute = (q) => q.populate('provider', 'name businessProfile.businessName');

// GET /api/admin/finance/disputes?status=open|closed
exports.listDisputes = async (req, res) => {
    try {
        const filter = req.query.status === 'closed' ? { status: { $ne: 'open' } } : { status: 'open' };
        const rows = await populateDispute(Dispute.find(filter).sort(req.query.status === 'closed' ? { closedAt: -1 } : { deadlineAt: 1, createdAt: 1 }).limit(200)).lean();
        res.json({ success: true, data: rows.map(disputeRow) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/admin/finance/disputes { paymentId, kind, amountCents?, deadlineAt?, caseReference?, summary }
exports.openDispute = async (req, res) => {
    try {
        const b = req.body || {};
        if (!KINDS.includes(b.kind)) return fail(res, 400, 'Choose what kind of case it is', 'bad_kind');
        const p = await loadPayment(b.paymentId);
        if (!p) return fail(res, 404, 'Payment not found');
        if (!Payment.SETTLED.includes(p.status)) return fail(res, 409, 'Only a payment that was paid can be disputed', 'not_paid');
        const summary = text(b.summary, 1000);
        if (!summary) return fail(res, 400, 'Say what the case is about', 'summary_required');
        const amountCents = b.amountCents === undefined || b.amountCents === null ? p.amountCents : b.amountCents;
        if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > p.amountCents) {
            return fail(res, 400, `The amount must be between N$0.01 and ${money(p.amountCents)}`, 'bad_amount');
        }
        let deadlineAt = null;
        if (b.deadlineAt) {
            deadlineAt = new Date(b.deadlineAt);
            if (Number.isNaN(deadlineAt.getTime())) return fail(res, 400, 'The deadline is not a date', 'bad_deadline');
        }
        if (await Dispute.exists({ payment: p._id, status: 'open' })) return fail(res, 409, 'This payment already has an open case', 'dispute_open');
        const settings = await pricing.getSettings();
        const d = await Dispute.create({
            payment: p._id, provider: p.provider, appointment: p.appointment, kind: b.kind, amountCents, currency: p.currency,
            feeCents: b.kind === 'chargeback' && Number.isFinite(settings.chargebackFeeCents) ? settings.chargebackFeeCents : 0,
            caseReference: text(b.caseReference, 120), deadlineAt, summary, openedBy: req.user._id,
        });
        await recordFinance({
            actor: req.user, action: 'dispute.open', amountCents, provider: p.provider, appointment: p.appointment, payment: p._id,
            reference: p.reference, reason: summary, details: { dispute: d._id, kind: b.kind },
        });
        if (b.kind === 'chargeback') {
            createNotification(p.provider, `A client disputed a card payment of ${money(amountCents)} with their bank. Bookplus is handling it and may ask you for proof that the service was provided.`, 'system', '/account?section=payments').catch(() => {});
        }
        res.status(201).json({ success: true, data: disputeRow(d.toObject()) });
    } catch (err) {
        logger.error({ err: err.message }, 'open dispute failed');
        fail(res, 500, 'Internal server error');
    }
};

const loadDispute = async (id) => (isId(id) ? Dispute.findById(id) : null);

// GET /api/admin/finance/disputes/:id — the case, its payment, notes and evidence
exports.getDispute = async (req, res) => {
    try {
        const d = await populateDispute(Dispute.findById(isId(req.params.id) ? req.params.id : null))
            .populate('notes.by', 'name').populate('evidence.by', 'name').populate('openedBy', 'name').populate('closedBy', 'name').lean();
        if (!d) return fail(res, 404, 'Case not found');
        const [payment, requests] = await Promise.all([
            freshRow(d.payment),
            FinanceRequest.find({ $or: [{ dispute: d._id }, { _id: { $in: [d.refundRequest, d.recovery?.request].filter(Boolean) } }] })
                .sort({ createdAt: -1 }).populate('preparedBy', 'name').populate('decidedBy', 'name').lean(),
        ]);
        res.json({
            success: true,
            data: {
                ...disputeRow(d),
                openedBy: d.openedBy?.name || null,
                closedBy: d.closedBy?.name || null,
                notes: (d.notes || []).map((n) => ({ _id: n._id, text: n.text, by: n.by?.name || null, at: n.at })),
                // Never the storage reference: a file opens through a 5-minute link.
                evidence: (d.evidence || []).map((e) => ({ _id: e._id, name: e.name, format: e.format, by: e.by?.name || null, at: e.at })),
                payment,
                requests: requests.map(finance.requestRow),
                uploadsAvailable: cloudinary.isConfigured(),
            },
        });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/admin/finance/disputes/:id/notes { text }
exports.addDisputeNote = async (req, res) => {
    try {
        const note = text(req.body?.text, 2000);
        if (!note) return fail(res, 400, 'Write the note', 'text_required');
        const d = await Dispute.findOneAndUpdate(
            { _id: isId(req.params.id) ? req.params.id : null },
            { $push: { notes: { text: note, by: req.user._id, at: new Date() } } },
            { new: true },
        );
        if (!d) return fail(res, 404, 'Case not found');
        res.status(201).json({ success: true });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

const MAX_EVIDENCE = 20;

// POST /api/admin/finance/disputes/:id/evidence/upload — signed private upload
exports.evidenceUploadParams = async (req, res) => {
    try {
        const d = await loadDispute(req.params.id);
        if (!d) return fail(res, 404, 'Case not found');
        if (!cloudinary.isConfigured()) return fail(res, 503, 'Files can not be uploaded right now (file storage is not set up).', 'uploads_unavailable');
        if ((d.evidence || []).length >= MAX_EVIDENCE) return fail(res, 409, `A case can hold ${MAX_EVIDENCE} files.`, 'too_many_files');
        res.json({ success: true, data: cloudinary.disputeUploadParams(String(d._id)) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/admin/finance/disputes/:id/evidence { name, ref }
exports.addEvidence = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Case not found');
        const ref = cloudinary.cleanDisputeRef(req.body?.ref, String(req.params.id));
        if (!ref) return fail(res, 400, 'That file was not uploaded to this case', 'bad_ref');
        const d = await Dispute.findOneAndUpdate(
            { _id: req.params.id, [`evidence.${MAX_EVIDENCE - 1}`]: { $exists: false } },
            { $push: { evidence: { ...ref, name: text(req.body?.name, 200) || 'Evidence', by: req.user._id, at: new Date() } } },
            { new: true },
        );
        if (!d) return fail(res, (await Dispute.exists({ _id: req.params.id })) ? 409 : 404, 'Could not add the file', 'not_added');
        await recordFinance({ actor: req.user, action: 'dispute.evidence', provider: d.provider, payment: d.payment, details: { dispute: d._id, name: text(req.body?.name, 200) } });
        res.status(201).json({ success: true });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// GET /api/admin/finance/disputes/:id/evidence/:evidenceId — a 5-minute link (audited)
exports.getEvidence = async (req, res) => {
    try {
        const d = await loadDispute(req.params.id);
        const e = d && isId(req.params.evidenceId) ? d.evidence.id(req.params.evidenceId) : null;
        if (!e) return fail(res, 404, 'File not found');
        if (!cloudinary.isConfigured()) return fail(res, 503, 'Files can not be opened right now (file storage is not set up).', 'uploads_unavailable');
        await recordFinance({ actor: req.user, action: 'dispute.evidence_view', provider: d.provider, payment: d.payment, details: { dispute: d._id, evidence: e._id } });
        res.json({
            success: true,
            data: {
                url: cloudinary.privateDownloadUrl({ publicId: e.publicId, format: e.format, resourceType: e.resourceType, type: e.deliveryType }),
                expiresInSeconds: cloudinary.PROOF_LINK_SECONDS,
            },
        });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/admin/finance/disputes/:id/refund { amountCents?, reason } — a complaint upheld
exports.refundFromDispute = async (req, res) => {
    try {
        const d = await loadDispute(req.params.id);
        if (!d) return fail(res, 404, 'Case not found');
        if (d.status !== 'open') return fail(res, 409, 'This case is closed', 'closed');
        if (d.kind === 'chargeback') return fail(res, 409, 'In a chargeback the card company returns the money itself; record the outcome instead.', 'chargeback');
        if (d.refundRequest && await FinanceRequest.exists({ _id: d.refundRequest, status: 'pending' })) {
            return fail(res, 409, 'A refund for this case is waiting for a director', 'request_pending');
        }
        const payment = await Payment.findById(d.payment).lean();
        const r = await finance.prepareRefundFor({
            actor: req.user, payment, amountCents: req.body?.amountCents, reason: text(req.body?.reason, 1000), dispute: d._id,
        });
        if (r.request) await Dispute.updateOne({ _id: d._id }, { $set: { refundRequest: r.request._id } });
        if (r.ran && r.body.success) {
            await Dispute.updateOne({ _id: d._id, status: 'open' }, { $set: { status: 'refunded', closedBy: req.user._id, closedAt: new Date() } });
        }
        res.status(r.status).json(r.body);
    } catch (err) {
        logger.error({ err: err.message }, 'dispute refund failed');
        fail(res, 500, 'Internal server error');
    }
};

/**
 * POST /api/admin/finance/disputes/:id/close { outcome: won|lost|closed, note, recover?: { amountCents? } }
 * A lost chargeback can be recovered from the business: a request a director
 * approves; it then takes one `chargeback:<id>` ledger entry (never twice).
 */
exports.closeDispute = async (req, res) => {
    try {
        const outcome = req.body?.outcome;
        if (!['won', 'lost', 'closed'].includes(outcome)) return fail(res, 400, 'Choose how it ended', 'bad_outcome');
        const note = text(req.body?.note, 1000);
        if (!note) return fail(res, 400, 'Say how it ended', 'note_required');
        const d = await loadDispute(req.params.id);
        if (!d) return fail(res, 404, 'Case not found');
        if (d.status !== 'open') return fail(res, 409, 'This case is closed', 'closed');
        if (outcome !== 'closed' && d.kind !== 'chargeback') return fail(res, 400, 'Won or lost is for chargebacks; close a complaint instead', 'bad_outcome');
        const recover = outcome === 'lost' && req.body?.recover;
        let amount = 0;
        if (recover) {
            amount = req.body.recover.amountCents === undefined || req.body.recover.amountCents === null
                ? d.amountCents + (d.feeCents || 0)
                : req.body.recover.amountCents;
            if (!Number.isInteger(amount) || amount <= 0 || amount > d.amountCents + (d.feeCents || 0)) {
                return fail(res, 400, `Recover between N$0.01 and ${money(d.amountCents + (d.feeCents || 0))} (the amount and the fee)`, 'bad_amount');
            }
        }
        const closed = await Dispute.findOneAndUpdate(
            { _id: d._id, status: 'open' },
            { $set: { status: outcome, outcomeNote: note, closedBy: req.user._id, closedAt: new Date() } },
            { new: true },
        );
        if (!closed) return fail(res, 409, 'This case is closed', 'closed');
        await recordFinance({
            actor: req.user, action: `dispute.${outcome}`, amountCents: d.amountCents, provider: d.provider, appointment: d.appointment,
            payment: d.payment, reason: note, details: { dispute: d._id, feeCents: d.feeCents || 0 },
        });
        if (recover) {
            const request = await FinanceRequest.create({
                type: 'recovery', provider: d.provider, payment: d.payment, appointment: d.appointment, dispute: d._id,
                amountCents: amount, currency: d.currency, reason: `Chargeback lost${d.caseReference ? ` (case ${d.caseReference})` : ''}: ${note}`.slice(0, 1000),
                preparedBy: req.user._id,
            });
            await Dispute.updateOne({ _id: d._id }, { $set: { recovery: { request: request._id, amountCents: amount, status: 'pending' } } });
            await recordFinance({
                actor: req.user, action: 'recovery.request', amountCents: amount, provider: d.provider, payment: d.payment,
                reason: request.reason, approvalStatus: 'pending', request: request._id, details: { dispute: d._id },
            });
        }
        res.json({ success: true, message: recover ? 'Closed. Recovering it from the business waits for a director.' : 'Closed', data: disputeRow((await Dispute.findById(d._id).lean())) });
    } catch (err) {
        logger.error({ err: err.message }, 'close dispute failed');
        fail(res, 500, 'Internal server error');
    }
};

/* ───────────────────────────── dashboard ───────────────────────────── */

// GET /api/admin/finance/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD (default: this month so far)
exports.dashboard = async (req, res) => {
    try {
        const period = financeDashboard.periodOf(req.query.from, req.query.to);
        if (!period) return fail(res, 400, 'Choose a period of at most two years, with the start before the end', 'bad_period');
        res.json({ success: true, data: await financeDashboard.dashboard({ period }) });
    } catch (err) {
        logger.error({ err: err.message }, 'finance dashboard failed');
        fail(res, 500, 'Internal server error');
    }
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// GET /api/admin/finance/costs?month=YYYY-MM — the running costs entered for a month
exports.getCosts = async (req, res) => {
    try {
        const month = String(req.query.month || '');
        if (!MONTH.test(month)) return fail(res, 400, 'Choose a month', 'bad_month');
        const doc = await OperatingCost.findOne({ month }).populate('updatedBy', 'name').lean();
        res.json({
            success: true,
            data: {
                month,
                items: doc?.items || [],
                totalCents: (doc?.items || []).reduce((s, i) => s + i.amountCents, 0),
                updatedAt: doc?.updatedAt || null,
                updatedBy: doc?.updatedBy?.name || null,
                categories: OperatingCost.CATEGORIES,
            },
        });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// PUT /api/admin/finance/costs/:month { items: [{ category, label, amountCents }], reason } (director)
exports.putCosts = async (req, res) => {
    try {
        const month = String(req.params.month || '');
        if (!MONTH.test(month)) return fail(res, 400, 'Choose a month', 'bad_month');
        const raw = Array.isArray(req.body?.items) ? req.body.items : null;
        if (!raw || raw.length > 30) return fail(res, 400, 'Send the list of costs (at most 30)', 'bad_items');
        const items = [];
        for (const i of raw) {
            if (!OperatingCost.CATEGORIES.includes(i?.category)) return fail(res, 400, 'Each cost needs a category', 'bad_category');
            if (!Number.isInteger(i.amountCents) || i.amountCents < 0 || i.amountCents > 1e10) return fail(res, 400, 'Amounts must be whole cents, 0 or more', 'bad_amount');
            items.push({ category: i.category, label: text(i.label, 80), amountCents: i.amountCents });
        }
        const before = await OperatingCost.findOne({ month }).lean();
        const doc = await OperatingCost.findOneAndUpdate(
            { month },
            { $set: { items, updatedBy: req.user._id } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        );
        const total = items.reduce((s, i) => s + i.amountCents, 0);
        await recordFinance({
            actor: req.user, action: 'costs.update', amountCents: total, reason: text(req.body?.reason, 500),
            details: { month, before: (before?.items || []).reduce((s, i) => s + i.amountCents, 0), after: total },
        });
        res.json({ success: true, data: { month, items: doc.items, totalCents: total } });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

exports._test = { nextRunDate };
