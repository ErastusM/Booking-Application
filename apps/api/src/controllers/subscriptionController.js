/**
 * Business subscriptions (services/subscriptions.js). No money moves yet:
 * this shows who is kept free or in a trial, and lets a director move a
 * business. Every change is written to the audit log.
 */
const subs = require('../services/subscriptions');
const pricing = require('../services/pricing');
const PlatformSettings = require('../models/PlatformSettings');
const { recordFinance } = require('../utils/financeAudit');

const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
const reasonOf = (req) => String(req.body?.reason || '').trim().slice(0, 500);

// GET /api/subscriptions/me (business owner). Hidden until the owner of
// Bookplus shows plans to businesses.
exports.mine = async (req, res) => {
    try {
        const settings = await pricing.getSettings();
        if (!settings.subscriptions?.showToBusinesses) return res.json({ success: true, data: { visible: false } });
        const sub = await subs.forProvider(req.user);
        res.json({ success: true, data: { visible: true, ...subs.describe(sub) } });
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
        res.json({ success: true, data: { rows, counts, showToBusinesses: !!settings.subscriptions?.showToBusinesses, startedAt: settings.subscriptions?.startedAt || null } });
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
