/**
 * /api/admin/finance — Bookplus's own money controls (payment specification,
 * sections 1, 2, 7 and 15): the pricing and fee settings, the pricing
 * simulator, the launch checklist, the financial audit log, finance roles, and
 * the second-person approvals for refunds and balance adjustments.
 *
 * Every route needs an admin session that passed two-step sign-in
 * (utils/financeRoles.requireFinance). Every change is written to the audit log.
 */
const mongoose = require('mongoose');
const pino = require('pino');
const User = require('../models/User');
const Payment = require('../models/Payment');
const PlatformSettings = require('../models/PlatformSettings');
const FinancialAuditLog = require('../models/FinancialAuditLog');
const FinanceRequest = require('../models/FinanceRequest');
const LedgerEntry = require('../models/LedgerEntry');
const pricing = require('../services/pricing');
const payments = require('../services/paymentService');
const { recordFinance } = require('../utils/financeAudit');
const { FINANCE_ROLES, financeRolesOf, hasFinanceRole } = require('../utils/financeRoles');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });

/* ───────────────────────────── settings ───────────────────────────── */

// Every editable setting: its path, and the check its value must pass.
const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const intOrNull = (min, max) => (v) => v === null || int(min, max)(v);
const EDITABLE = {
    'plans.basic.label': (v) => typeof v === 'string' && v.trim().length >= 1 && v.length <= 40,
    'plans.basic.trialDays': int(0, 365),
    'plans.basic.introMonths': int(0, 60),
    'plans.basic.introPriceCents': int(0, 100000000),
    'plans.basic.priceCents': int(0, 100000000),
    'plans.basic.priceChangeNoticeDays': int(0, 90),
    'plans.basic.commissionBps': int(0, 10000),
    'plans.basic.fixedFeeCents': int(0, 10000000),
    'plans.standard.label': (v) => typeof v === 'string' && v.trim().length >= 1 && v.length <= 40,
    'plans.standard.priceCents': int(0, 100000000),
    'plans.standard.commissionBps': int(0, 10000),
    'plans.standard.fixedFeeCents': int(0, 10000000),
    'processingFee.bps': intOrNull(0, 10000),
    'processingFee.fixedCents': intOrNull(0, 10000000),
    'processingFee.payer': (v) => ['business', 'bookplus'].includes(v),
    chargebackFeeCents: intOrNull(0, 100000000),
    minCommissionCents: int(0, 10000000),
    minOnlineBookingCents: int(0, 100000000),
    opsCostPerTxCents: int(0, 10000000),
    'payout.frequency': (v) => ['weekly', 'biweekly', 'monthly'].includes(v),
    'payout.weekday': int(0, 6),
    'payout.minThresholdCents': int(0, 100000000),
    'vat.registered': (v) => typeof v === 'boolean',
    'vat.number': (v) => typeof v === 'string' && v.length <= 40,
    'vat.ratePct': (v) => typeof v === 'number' && v >= 0 && v <= 100,
    'approvals.refundThresholdCents': int(0, 100000000),
    'approvals.adjustmentsNeedApproval': (v) => typeof v === 'boolean',
};
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const LAUNCH_GATES = ['providerApproved', 'pricingApproved', 'legalCleared', 'termsReviewed', 'liveTestPassed', 'payoutScheduleConfirmed'];

/** What still stands between Bookplus and switching payments on. */
const launchChecklist = (settings, sim) => {
    const gates = LAUNCH_GATES.map((g) => ({
        key: g,
        done: !!settings.launch?.[g]?.at,
        at: settings.launch?.[g]?.at || null,
        by: settings.launch?.[g]?.by || null,
        note: settings.launch?.[g]?.note || '',
    }));
    const automatic = [
        { key: 'processingFeeEntered', done: sim.processingFeeKnown },
        { key: 'chargebackFeeEntered', done: sim.chargebackFeeKnown },
        { key: 'noNegativeMargin', done: !sim.anyNegative },
    ];
    const all = [...automatic, ...gates];
    return { ready: all.every((i) => i.done), items: all };
};

const settingsPayload = (settings, user) => {
    const sim = pricing.simulate(settings);
    return { settings, simulator: sim, launch: launchChecklist(settings, sim), me: { roles: financeRolesOf(user) } };
};

// GET /api/admin/finance/settings
exports.getSettings = async (req, res) => {
    try {
        const settings = await pricing.getSettings({ fresh: true });
        res.json({ success: true, data: settingsPayload(settings, req.user) });
    } catch (err) {
        logger.error({ err: err.message }, 'finance settings read failed');
        fail(res, 500, 'Internal server error');
    }
};

// { plans: { basic: { commissionBps: 150 } } } → { 'plans.basic.commissionBps': 150 }.
// Requests carry nested objects: the request sanitizer drops dotted keys.
const flatten = (obj, prefix = '', out = {}) => {
    for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
        else out[path] = v;
    }
    return out;
};

// PUT /api/admin/finance/settings { changes: { plans: { basic: { commissionBps: 150 } }, ... }, reason }
exports.updateSettings = async (req, res) => {
    try {
        const { reason } = req.body || {};
        const nested = req.body?.changes;
        if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return fail(res, 400, 'Send the changes as { section: { setting: value } }');
        const changes = flatten(nested);
        if (!reason || typeof reason !== 'string' || !reason.trim()) return fail(res, 400, 'Say why the settings are changing', 'reason_required');
        const before = await pricing.getSettings({ fresh: true });
        const set = {};
        const diff = [];
        for (const [path, value] of Object.entries(changes)) {
            const check = EDITABLE[path];
            if (!check) return fail(res, 400, `${path} can't be changed here`, 'unknown_setting');
            const v = typeof value === 'string' && path !== 'vat.number' && !path.endsWith('.label') && !['processingFee.payer', 'payout.frequency'].includes(path) ? Number(value) : value;
            if (!check(v)) return fail(res, 400, `${path} has an invalid value`, 'bad_value');
            if (get(before, path) !== v) {
                set[path] = typeof v === 'string' ? v.trim() : v;
                diff.push({ path, from: get(before, path) ?? null, to: set[path] });
            }
        }
        if (!diff.length) return res.json({ success: true, message: 'Nothing changed', data: settingsPayload(before, req.user) });
        await PlatformSettings.updateOne({ key: 'platform' }, { $set: { ...set, updatedBy: req.user._id }, $inc: { version: 1 } });
        pricing.invalidateSettings();
        const after = await pricing.getSettings({ fresh: true });
        await recordFinance({
            actor: req.user, action: 'settings.update', reason: reason.trim(),
            reference: `v${after.version}`, details: { changes: diff },
        });
        res.json({ success: true, message: 'Settings saved', data: settingsPayload(after, req.user) });
    } catch (err) {
        logger.error({ err: err.message }, 'finance settings update failed');
        fail(res, 500, 'Internal server error');
    }
};

// POST /api/admin/finance/launch/:gate { done: true|false, note }
exports.setLaunchGate = async (req, res) => {
    try {
        const gate = req.params.gate;
        if (!LAUNCH_GATES.includes(gate)) return fail(res, 404, 'Unknown checklist item');
        const done = req.body?.done !== false;
        const note = String(req.body?.note || '').trim().slice(0, 500);
        if (done && !note) return fail(res, 400, 'Add a note: what confirmed it (e.g. the email or document)', 'note_required');
        await PlatformSettings.updateOne({ key: 'platform' }, {
            $set: { [`launch.${gate}`]: done ? { at: new Date(), by: req.user._id, note } : { at: null, by: null, note: '' } },
            $inc: { version: 1 },
        });
        pricing.invalidateSettings();
        await recordFinance({ actor: req.user, action: done ? 'launch.confirm' : 'launch.unconfirm', reference: gate, reason: note });
        const after = await pricing.getSettings({ fresh: true });
        res.json({ success: true, data: settingsPayload(after, req.user) });
    } catch (err) {
        logger.error({ err: err.message }, 'launch gate update failed');
        fail(res, 500, 'Internal server error');
    }
};

// GET /api/admin/finance/simulate?values=5000,10000 — the simulator for other amounts
exports.simulate = async (req, res) => {
    try {
        const settings = await pricing.getSettings();
        const values = String(req.query.values || '').split(',').map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0 && v <= 100000000).slice(0, 20);
        res.json({ success: true, data: pricing.simulate(settings, values.length ? values : undefined) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

/* ───────────────────────────── audit log ───────────────────────────── */

// GET /api/admin/finance/audit?before=<id>&provider=<id>&action=<a>
exports.getAudit = async (req, res) => {
    try {
        const q = {};
        if (isId(req.query.provider)) q.provider = req.query.provider;
        if (typeof req.query.action === 'string' && req.query.action) q.action = String(req.query.action).slice(0, 80);
        if (isId(req.query.before)) q._id = { $lt: req.query.before };
        const rows = await FinancialAuditLog.find(q).sort({ _id: -1 }).limit(50)
            .populate('actor', 'name email').populate('provider', 'name businessProfile.businessName').lean();
        res.json({ success: true, data: rows, next: rows.length === 50 ? rows[rows.length - 1]._id : null });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

/* ───────────────────────────── roles ───────────────────────────── */

// GET /api/admin/finance/admins — admins and their money roles
exports.listAdmins = async (req, res) => {
    try {
        const admins = await User.find({ role: 'admin' }).select('name email role adminRoles mfa.enabled').lean();
        res.json({
            success: true,
            data: admins.map((a) => ({ _id: a._id, name: a.name, email: a.email, roles: financeRolesOf(a), mfaEnabled: !!a.mfa?.enabled })),
        });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// PUT /api/admin/finance/admins/:id/roles { roles: ['finance'] }
exports.setAdminRoles = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Admin not found');
        const roles = Array.isArray(req.body?.roles) ? [...new Set(req.body.roles)] : null;
        if (!roles || !roles.every((r) => FINANCE_ROLES.includes(r))) return fail(res, 400, 'roles must be a list of finance and/or director');
        const target = await User.findOne({ _id: req.params.id, role: 'admin' });
        if (!target) return fail(res, 404, 'Admin not found');
        if (String(target._id) === String(req.user._id) && !roles.includes('director')) {
            // Keep at least one director: nobody demotes themselves out of it.
            return fail(res, 400, 'You can\'t remove your own director role', 'self_demotion');
        }
        const before = financeRolesOf(target);
        await User.updateOne({ _id: target._id }, { $set: { adminRoles: roles } });
        await recordFinance({ actor: req.user, action: 'roles.update', reference: target.email, details: { from: before, to: roles } });
        res.json({ success: true, data: { _id: target._id, roles } });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/admin/finance/admins/:id/reset-mfa { reason } — for an admin who
// lost their phone and recovery codes. Signs them out everywhere; they set
// two-step sign-in up again. Never on yourself.
exports.resetAdminMfa = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Admin not found');
        if (String(req.params.id) === String(req.user._id)) return fail(res, 400, 'Another director must do this for you', 'same_person');
        const reason = String(req.body?.reason || '').trim();
        if (!reason) return fail(res, 400, 'Say why', 'reason_required');
        const target = await User.findOne({ _id: req.params.id, role: 'admin' }).select('email');
        if (!target) return fail(res, 404, 'Admin not found');
        await User.updateOne({ _id: target._id }, { $unset: { mfa: '' }, $inc: { tokenVersion: 1 }, $set: { refreshTokenJtis: [] } });
        await recordFinance({ actor: req.user, action: 'security.mfa_reset', reference: target.email, reason });
        res.json({ success: true, message: 'Two-step sign-in was reset. They are signed out and set it up again at their next sign-in.' });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

/* ───────────────────────────── a business's pricing ───────────────────────────── */

// PUT /api/admin/finance/businesses/:id/pricing { plan, override: { commissionBps, fixedFeeCents } | null, migrate, reason }
// `migrate: true` moves the business to the plan's CURRENT rates (an explicit
// migration); otherwise the rates it agreed stay as they are.
exports.setBusinessPricing = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Business not found');
        const { plan, override, migrate, reason } = req.body || {};
        if (!reason || !String(reason).trim()) return fail(res, 400, 'Say why', 'reason_required');
        const business = await User.findOne({ _id: req.params.id, role: 'provider' }).select('pricing name').lean();
        if (!business) return fail(res, 404, 'Business not found');
        const settings = await pricing.getSettings();
        const set = {};
        if (plan !== undefined) {
            if (!pricing.PLANS.includes(plan)) return fail(res, 400, 'plan must be basic or standard');
            set['pricing.plan'] = plan;
        }
        const targetPlan = plan || business.pricing?.plan;
        if (!targetPlan) return fail(res, 400, 'Choose a plan first');
        if (migrate === true || plan !== undefined) {
            const p = settings.plans[targetPlan];
            set['pricing.rates'] = { commissionBps: p.commissionBps, fixedFeeCents: p.fixedFeeCents };
            set['pricing.pricingVersion'] = settings.version;
            set['pricing.planAssignedAt'] = new Date();
        }
        if (override !== undefined) {
            if (override === null) set['pricing.override'] = null;
            else {
                const o = {};
                if (override.commissionBps !== undefined && override.commissionBps !== null) {
                    if (!int(0, 10000)(override.commissionBps)) return fail(res, 400, 'commissionBps must be 0 to 10 000');
                    o.commissionBps = override.commissionBps;
                }
                if (override.fixedFeeCents !== undefined && override.fixedFeeCents !== null) {
                    if (!int(0, 10000000)(override.fixedFeeCents)) return fail(res, 400, 'fixedFeeCents must be a whole number of cents');
                    o.fixedFeeCents = override.fixedFeeCents;
                }
                set['pricing.override'] = Object.keys(o).length ? o : null;
            }
        }
        await User.updateOne({ _id: business._id }, { $set: set });
        const fresh = await User.findById(business._id).select('pricing').lean();
        await recordFinance({
            actor: req.user, action: 'business.pricing', provider: business._id, reason: String(reason).trim(),
            details: { from: business.pricing || null, to: fresh.pricing },
        });
        res.json({ success: true, data: { pricing: fresh.pricing, rates: pricing.ratesFor(fresh, settings) } });
    } catch (err) {
        logger.error({ err: err.message }, 'business pricing update failed');
        fail(res, 500, 'Internal server error');
    }
};

/* ───────────────────────────── refunds and adjustments ───────────────────────────── */

const requestRow = (r) => ({
    _id: r._id, type: r.type, status: r.status, provider: r.provider, payment: r.payment, appointment: r.appointment,
    amountCents: r.amountCents, currency: r.currency, reason: r.reason,
    preparedBy: r.preparedBy, decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    requestedByBusiness: !!r.requestedByBusiness, result: r.result, createdAt: r.createdAt,
});

/**
 * A business asks Bookplus to refund more than it may on its own (more than
 * its balance, or above the approval limit). It waits in the same queue as
 * finance's own requests, for a director to approve or reject. One open
 * request per payment. Call it holding the business's `payout:<id>` lock.
 */
exports.requestRefundFromBusiness = async ({ owner, payment, amountCents, reason }) => {
    if (!reason) return { ok: false, status: 400, code: 'reason_required', error: 'Say why the client should get this refund, so Bookplus can decide.' };
    const open = await FinanceRequest.exists({ payment: payment._id, type: 'refund', status: 'pending' });
    if (open) return { ok: false, status: 409, code: 'request_pending', error: 'Bookplus is already looking at a refund for this payment.' };
    const request = await FinanceRequest.create({
        type: 'refund', provider: payment.provider, payment: payment._id, appointment: payment.appointment,
        amountCents, currency: payment.currency, reason, preparedBy: owner._id, requestedByBusiness: true,
    });
    await recordFinance({
        actor: owner, action: 'refund.request', amountCents, provider: payment.provider, appointment: payment.appointment,
        payment: payment._id, reference: payment.reference, reason, approvalStatus: 'pending', request: request._id,
        details: { requestedByBusiness: true },
    });
    return { ok: true, request: requestRow(request) };
};

/**
 * POST /api/admin/finance/payments/:id/refund { amountCents?, reason }
 * Finance prepares a refund. At or below the approval threshold it runs at
 * once; above it, it waits for a director who didn't prepare it.
 */
exports.prepareRefund = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Payment not found');
        const payment = await Payment.findById(req.params.id).lean();
        if (!payment) return fail(res, 404, 'Payment not found');
        const reason = String(req.body?.reason || '').trim();
        if (!reason) return fail(res, 400, 'Say why the refund is being made', 'reason_required');
        const remaining = payment.amountCents - (payment.refundedCents || 0) - (payment.refundingCents || 0);
        const amt = req.body?.amountCents === undefined || req.body?.amountCents === null ? remaining : req.body.amountCents;
        if (!Number.isInteger(amt) || amt <= 0) return fail(res, 400, 'amountCents must be a whole number of cents above 0', 'bad_amount');
        if (amt > remaining) return fail(res, 409, 'More than is left to refund', 'exceeds_refundable');
        const settings = await pricing.getSettings();
        const threshold = settings.approvals?.refundThresholdCents ?? 0;

        if (amt <= threshold) {
            await recordFinance({
                actor: req.user, action: 'refund.execute', amountCents: amt, provider: payment.provider,
                appointment: payment.appointment, payment: payment._id, reference: payment.reference, reason,
            });
            const r = await payments.requestRefund({ paymentId: payment._id, amountCents: amt, reason, by: req.user._id, trigger: 'manual' });
            if (!r.ok && r.code) return fail(res, r.code === 'exceeds_refundable' ? 409 : 400, r.error, r.code);
            return res.status(r.ok ? 200 : 202).json({ success: r.ok, code: r.ok ? 'refunded' : 'refund_pending', message: r.ok ? 'Refund sent' : 'Saved; PayGate did not take it yet. It can be retried.' });
        }

        const request = await FinanceRequest.create({
            type: 'refund', provider: payment.provider, payment: payment._id, appointment: payment.appointment,
            amountCents: amt, currency: payment.currency, reason, preparedBy: req.user._id,
        });
        await recordFinance({
            actor: req.user, action: 'refund.request', amountCents: amt, provider: payment.provider, appointment: payment.appointment,
            payment: payment._id, reference: payment.reference, reason, approvalStatus: 'pending', request: request._id,
        });
        res.status(202).json({ success: true, code: 'approval_required', message: 'Above the approval limit: a director must approve it.', data: requestRow(request) });
    } catch (err) {
        logger.error({ err: err.message }, 'prepare refund failed');
        fail(res, 500, 'Internal server error');
    }
};

// POST /api/admin/finance/adjustments { providerId, amountCents (signed), reason }
exports.prepareAdjustment = async (req, res) => {
    try {
        const { providerId, amountCents } = req.body || {};
        const reason = String(req.body?.reason || '').trim();
        if (!isId(providerId)) return fail(res, 400, 'Choose the business');
        if (!Number.isInteger(amountCents) || amountCents === 0) return fail(res, 400, 'amountCents must be a whole, non-zero number of cents', 'bad_amount');
        if (!reason) return fail(res, 400, 'Say why', 'reason_required');
        const business = await User.findOne({ _id: providerId, role: 'provider' }).select('businessProfile.currency').lean();
        if (!business) return fail(res, 404, 'Business not found');
        const settings = await pricing.getSettings();
        const request = await FinanceRequest.create({
            type: 'adjustment', provider: business._id, amountCents, currency: business.businessProfile?.currency || 'NAD',
            reason, preparedBy: req.user._id,
        });
        const needsApproval = settings.approvals?.adjustmentsNeedApproval !== false;
        await recordFinance({
            actor: req.user, action: 'adjustment.request', amountCents, provider: business._id, reason,
            approvalStatus: needsApproval ? 'pending' : 'not_required', request: request._id,
        });
        if (!needsApproval) {
            const done = await runRequest(request, req.user);
            return res.json({ success: true, data: requestRow(done) });
        }
        res.status(202).json({ success: true, code: 'approval_required', message: 'A director must approve it.', data: requestRow(request) });
    } catch (err) {
        logger.error({ err: err.message }, 'prepare adjustment failed');
        fail(res, 500, 'Internal server error');
    }
};

// Carry out an approved request.
const runRequest = async (request, actor) => {
    try {
        if (request.type === 'refund') {
            const r = await payments.requestRefund({ paymentId: request.payment, amountCents: request.amountCents, reason: request.reason, by: actor._id, trigger: 'manual' });
            request.status = r.ok || !r.code ? 'executed' : 'failed';
            request.result = r.ok ? { refundId: r.refundId } : { error: r.error || 'PayGate did not take it yet', code: r.code || 'refund_pending', refundId: r.refundId || null };
        } else {
            await LedgerEntry.create({
                provider: request.provider, type: 'adjustment', amountCents: request.amountCents, currency: request.currency,
                note: request.reason, createdBy: actor._id, key: `adjustment:${request._id}`,
            });
            request.status = 'executed';
            request.result = { ledgerKey: `adjustment:${request._id}` };
        }
    } catch (err) {
        request.status = 'failed';
        request.result = { error: err.message };
    }
    await request.save();
    await recordFinance({
        actor, action: `${request.type}.${request.status === 'executed' ? 'execute' : 'fail'}`, amountCents: request.amountCents,
        provider: request.provider, payment: request.payment, appointment: request.appointment, reason: request.reason,
        approvalStatus: 'approved', request: request._id, details: request.result,
    });
    return request;
};

// GET /api/admin/finance/requests?status=pending
exports.listRequests = async (req, res) => {
    try {
        const q = {};
        if (['pending', 'approved', 'rejected', 'executed', 'failed'].includes(req.query.status)) q.status = req.query.status;
        const rows = await FinanceRequest.find(q).sort({ createdAt: -1 }).limit(100)
            .populate('preparedBy', 'name email').populate('decidedBy', 'name email')
            .populate('provider', 'name businessProfile.businessName').lean();
        res.json({ success: true, data: rows.map(requestRow) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/admin/finance/requests/:id/approve { note } (director, not the preparer)
// POST /api/admin/finance/requests/:id/reject  { note }
const decide = (approve) => async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Request not found');
        const note = String(req.body?.note || '').trim().slice(0, 1000);
        if (!approve && !note) return fail(res, 400, 'Say why it is rejected', 'reason_required');
        const request = await FinanceRequest.findById(req.params.id);
        if (!request) return fail(res, 404, 'Request not found');
        if (request.status !== 'pending') return fail(res, 409, 'This request was already decided', 'already_decided');
        if (String(request.preparedBy) === String(req.user._id)) {
            return fail(res, 403, 'Someone else must approve a request you prepared', 'same_person');
        }
        // Claim it atomically so two directors can't both act on it.
        const claimed = await FinanceRequest.findOneAndUpdate(
            { _id: request._id, status: 'pending' },
            { $set: { status: approve ? 'approved' : 'rejected', decidedBy: req.user._id, decidedAt: new Date(), decisionNote: note } },
            { new: true },
        );
        if (!claimed) return fail(res, 409, 'This request was already decided', 'already_decided');
        await recordFinance({
            actor: req.user, action: `${claimed.type}.${approve ? 'approve' : 'reject'}`, amountCents: claimed.amountCents,
            provider: claimed.provider, payment: claimed.payment, appointment: claimed.appointment, reason: note || claimed.reason,
            approvalStatus: approve ? 'approved' : 'rejected', request: claimed._id,
        });
        const done = approve ? await runRequest(claimed, req.user) : claimed;
        if (done.requestedByBusiness) {
            const amount = `N$${(done.amountCents / 100).toFixed(2)}`;
            const message = !approve
                ? `Bookplus did not approve the ${amount} refund you asked for: ${note}`
                : done.status === 'executed'
                    ? `Bookplus approved the ${amount} refund you asked for. It is on its way back to your client's card.`
                    : `Bookplus approved the ${amount} refund you asked for. The card processor did not take it yet; it will be tried again.`;
            createNotification(done.provider, message, 'system', '/account?section=payments').catch(() => {});
        }
        res.json({ success: true, data: requestRow(done) });
    } catch (err) {
        logger.error({ err: err.message }, 'finance decision failed');
        fail(res, 500, 'Internal server error');
    }
};
exports.approveRequest = decide(true);
exports.rejectRequest = decide(false);

/* ───────────────────────────── business approvals ───────────────────────────── */

const approvalRules = require('../services/paymentsApproval');
const cloudinary = require('../utils/cloudinary');
const { createNotification } = require('../utils/notificationhelper');

const approvalRow = (u) => ({
    _id: u._id,
    name: u.name,
    email: u.email,
    businessName: u.businessProfile?.businessName || '',
    status: approvalRules.statusOf(u.paymentsApproval),
    plan: u.paymentsApproval?.plan || null,
    submittedAt: u.paymentsApproval?.submittedAt || null,
    decidedAt: u.paymentsApproval?.decidedAt || null,
    takingPayments: approvalRules.canTakePayments(u.paymentsApproval),
    adminOff: !!u.paymentsApproval?.adminOff,
    payoutAccountReviewNeeded: !!u.paymentsApproval?.payoutAccountReviewNeeded,
});

// GET /api/admin/finance/approvals?status=submitted (default: waiting for Bookplus)
exports.listApprovals = async (req, res) => {
    try {
        const status = String(req.query.status || 'waiting');
        const q = { role: 'provider', paymentsApproval: { $exists: true } };
        if (status === 'waiting') q.$or = [{ 'paymentsApproval.status': 'submitted' }, { 'paymentsApproval.payoutAccountReviewNeeded': true }];
        else if (approvalRules.STATUSES.includes(status)) q['paymentsApproval.status'] = status;
        const rows = await User.find(q).select('+paymentsApproval name email businessProfile.businessName')
            .sort({ 'paymentsApproval.submittedAt': 1 }).limit(200).lean();
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, data: rows.map(approvalRow) });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

const loadBusiness = (id) => User.findOne({ _id: id, role: 'provider' })
    .select('+paymentsApproval +payoutAccount name email phone businessProfile.businessName businessProfile.address createdAt isActive pricing');

// GET /api/admin/finance/approvals/:id — everything a reviewer needs
exports.getApproval = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Business not found');
        const u = await loadBusiness(req.params.id).lean();
        if (!u || !u.paymentsApproval) return fail(res, 404, 'No application from this business');
        // The full ID and bank account numbers are shown here: who looked is recorded.
        await recordFinance({ actor: req.user, action: 'approval.view', provider: u._id });
        res.set('Cache-Control', 'no-store');
        res.json({
            success: true,
            data: {
                ...approvalRow(u),
                phone: u.phone || '',
                address: u.businessProfile?.address || '',
                accountCreatedAt: u.createdAt,
                suspended: u.isActive === false,
                application: approvalRules.reviewView(u.paymentsApproval),
                missing: approvalRules.missingFor(u.paymentsApproval, { hasPayoutAccount: payments.hasPayoutAccount(u.payoutAccount) }),
                // The full account number: the reviewer matches it against the bank letter.
                payoutAccount: payments.publicPayoutAccount(u.payoutAccount, { full: true }),
                pricing: u.pricing || null,
            },
        });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// GET /api/admin/finance/approvals/:id/documents/:docId — a link that works for 5 minutes
exports.getApprovalDocument = async (req, res) => {
    try {
        if (!isId(req.params.id) || !isId(req.params.docId)) return fail(res, 404, 'Document not found');
        const u = await User.findOne({ _id: req.params.id, role: 'provider' }).select('+paymentsApproval').lean();
        const doc = (u?.paymentsApproval?.documents || []).find((d) => String(d._id) === String(req.params.docId));
        if (!doc) return fail(res, 404, 'Document not found');
        if (!cloudinary.isConfigured()) return fail(res, 503, 'Documents can not be opened right now (file storage is not set up).', 'uploads_unavailable');
        await recordFinance({ actor: req.user, action: 'approval.document_view', provider: u._id, reference: doc.kind });
        res.set('Cache-Control', 'no-store');
        res.json({
            success: true,
            data: {
                url: cloudinary.privateDownloadUrl({ publicId: doc.publicId, format: doc.format, resourceType: doc.resourceType, type: doc.deliveryType }),
                expiresInSeconds: cloudinary.PROOF_LINK_SECONDS,
                kind: doc.format === 'pdf' || doc.resourceType === 'raw' ? 'pdf' : 'image',
            },
        });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

const DECISIONS = { approve: 'approved', reject: 'rejected', request_info: 'info_requested' };
const DECISION_MESSAGES = {
    approved: 'Bookplus approved your business for online payments. Switch them on in Online payments when you are ready.',
    rejected: 'Bookplus could not approve your business for online payments. See Online payments for why.',
    info_requested: 'Bookplus needs a little more for your online payments application. See Online payments.',
};

// POST /api/admin/finance/approvals/:id/decision { decision: approve|reject|request_info, note }
exports.decideApproval = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Business not found');
        const to = DECISIONS[req.body?.decision];
        if (!to) return fail(res, 400, 'decision must be approve, reject or request_info');
        const note = String(req.body?.note || '').trim().slice(0, 1000);
        if (to !== 'approved' && !note) return fail(res, 400, 'Tell the business why, or what else is needed', 'reason_required');
        const u = await loadBusiness(req.params.id);
        if (!u || !u.paymentsApproval) return fail(res, 404, 'No application from this business');
        if (approvalRules.statusOf(u.paymentsApproval) !== 'submitted') return fail(res, 409, 'Only an application waiting for Bookplus can be decided', 'not_submitted');
        if (to === 'approved') {
            const missing = approvalRules.missingFor(u.paymentsApproval, { hasPayoutAccount: payments.hasPayoutAccount(u.payoutAccount) });
            if (missing.length) return res.status(409).json({ success: false, code: 'incomplete', message: 'The application is missing something', missing });
        }
        const now = new Date();
        const set = {
            'paymentsApproval.status': to, 'paymentsApproval.decidedAt': now,
            'paymentsApproval.decidedBy': req.user._id, 'paymentsApproval.decisionNote': note,
        };
        const docs = u.paymentsApproval.documents || [];
        if (to === 'approved') {
            // The business gets its chosen plan at today's rates (kept until
            // it is moved on purpose: setBusinessPricing).
            const settings = await pricing.getSettings();
            const plan = u.paymentsApproval.plan;
            const p = settings.plans[plan];
            Object.assign(set, {
                'pricing.plan': plan,
                'pricing.rates': { commissionBps: p.commissionBps, fixedFeeCents: p.fixedFeeCents },
                'pricing.pricingVersion': settings.version,
                'pricing.planAssignedAt': now,
                'paymentsApproval.switchOn': false,
                'paymentsApproval.payoutAccountReviewNeeded': false,
            });
        }
        if (to === 'rejected') set['paymentsApproval.documents'] = []; // deleted below, as the Privacy Policy says
        // Claim it atomically: two reviewers can't both decide it.
        const r = await User.updateOne(
            { _id: u._id, 'paymentsApproval.status': 'submitted' },
            { $set: set, $push: { 'paymentsApproval.history': { status: to, at: now, by: req.user._id, note } } },
        );
        if (r.modifiedCount !== 1) return fail(res, 409, 'Someone else decided it first', 'already_decided');
        await recordFinance({
            actor: req.user, action: `approval.${req.body.decision}`, provider: u._id, reason: note,
            reference: u.paymentsApproval.plan, approvalStatus: to === 'approved' ? 'approved' : to === 'rejected' ? 'rejected' : 'pending',
            // What the approval set: the plan's rates at that moment, and what was there before.
            details: to === 'approved'
                ? { pricingBefore: u.pricing || null, pricingAfter: { plan: set['pricing.plan'], rates: set['pricing.rates'], pricingVersion: set['pricing.pricingVersion'] } }
                : null,
        });
        if (to === 'rejected') {
            const { destroyVerificationFiles } = require('../utils/accountData');
            destroyVerificationFiles(u._id, docs).catch(() => {});
        }
        createNotification(u._id, DECISION_MESSAGES[to], 'system', '/account?section=payments').catch(() => {});
        const fresh = await loadBusiness(u._id).lean();
        res.json({ success: true, data: { ...approvalRow(fresh), application: approvalRules.reviewView(fresh.paymentsApproval) } });
    } catch (err) {
        logger.error({ err: err.message }, 'approval decision failed');
        fail(res, 500, 'Internal server error');
    }
};

// POST /api/admin/finance/approvals/:id/switch { off: true|false, reason } — Bookplus's override
exports.setApprovalSwitch = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Business not found');
        const off = req.body?.off;
        if (typeof off !== 'boolean') return fail(res, 400, 'off must be true or false');
        const reason = String(req.body?.reason || '').trim().slice(0, 500);
        if (!reason) return fail(res, 400, 'Say why', 'reason_required');
        const u = await User.findOne({ _id: req.params.id, role: 'provider', paymentsApproval: { $exists: true } }).select('_id');
        if (!u) return fail(res, 404, 'No application from this business');
        await User.updateOne({ _id: u._id }, {
            $set: { 'paymentsApproval.adminOff': off, 'paymentsApproval.adminOffReason': off ? reason : '' },
            $push: { 'paymentsApproval.history': { status: off ? 'switched_off_by_bookplus' : 'switch_released_by_bookplus', at: new Date(), by: req.user._id, note: reason } },
        });
        await recordFinance({ actor: req.user, action: off ? 'payments.admin_off' : 'payments.admin_on', provider: u._id, reason });
        if (off) createNotification(u._id, `Bookplus switched online payments off for your business: ${reason}`, 'system', '/account?section=payments').catch(() => {});
        res.json({ success: true });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

// POST /api/admin/finance/approvals/:id/payout-account-checked { note, accountUpdatedAt }
// — the new bank account is genuine. accountUpdatedAt is the version the
// reviewer looked at: if the business changed it again since, nothing is confirmed.
exports.confirmPayoutAccount = async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, 'Business not found');
        const note = String(req.body?.note || '').trim().slice(0, 500);
        if (!note) return fail(res, 400, 'Say how it was checked (e.g. new bank letter, call to the owner)', 'reason_required');
        const seen = new Date(req.body?.accountUpdatedAt || '');
        if (Number.isNaN(seen.getTime())) return fail(res, 400, 'Say which version of the account was checked', 'account_version_required');
        const u = await User.findOne({ _id: req.params.id, role: 'provider' }).select('+payoutAccount +paymentsApproval').lean();
        if (!u?.paymentsApproval?.payoutAccountReviewNeeded) return fail(res, 409, 'There is no new bank account waiting to be checked', 'nothing_to_check');
        const current = u.payoutAccount?.updatedAt ? new Date(u.payoutAccount.updatedAt) : null;
        if (!current || current.getTime() !== seen.getTime()) {
            return fail(res, 409, 'The bank account changed again since you opened it. Reload and check the new one.', 'account_changed');
        }
        const r = await User.updateOne(
            { _id: u._id, 'paymentsApproval.payoutAccountReviewNeeded': true, 'payoutAccount.updatedAt': current },
            { $set: { 'paymentsApproval.payoutAccountReviewNeeded': false } },
        );
        if (r.modifiedCount !== 1) return fail(res, 409, 'The bank account changed again since you opened it. Reload and check the new one.', 'account_changed');
        await recordFinance({
            actor: req.user, action: 'payout_account.confirm', provider: u._id, reason: note,
            details: { account: payments.publicPayoutAccount(u.payoutAccount) },
        });
        res.json({ success: true });
    } catch (err) { fail(res, 500, 'Internal server error'); }
};

exports._test = { EDITABLE, launchChecklist, hasFinanceRole, flatten };
