/**
 * /api/admin/finance — Bookplus's own money controls. Bookplus takes card
 * payments only for business subscriptions (no booking payments, no
 * commission): the plan's prices and VAT settings, the go-live checklist, the
 * PayGate connection check, the financial audit log and finance roles.
 *
 * Every route needs an admin session that passed two-step sign-in
 * (utils/financeRoles.requireFinance). Every change is written to the audit log.
 */
const mongoose = require('mongoose');
const pino = require('pino');
const User = require('../models/User');
const PlatformSettings = require('../models/PlatformSettings');
const FinancialAuditLog = require('../models/FinancialAuditLog');
const pricing = require('../services/pricing');
const { recordFinance } = require('../utils/financeAudit');
const { FINANCE_ROLES, financeRolesOf, hasFinanceRole } = require('../utils/financeRoles');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });

/* ───────────────────────────── settings ───────────────────────────── */

// Every editable setting: its path, and the check its value must pass.
const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const EDITABLE = {
    'plans.basic.label': (v) => typeof v === 'string' && v.trim().length >= 1 && v.length <= 40,
    'plans.basic.trialDays': int(0, 365),
    'plans.basic.introMonths': int(0, 60),
    'plans.basic.introPriceCents': int(0, 100000000),
    'plans.basic.priceCents': int(0, 100000000),
    'plans.basic.priceChangeNoticeDays': int(0, 90),
    'vat.registered': (v) => typeof v === 'boolean',
    'vat.number': (v) => typeof v === 'string' && v.length <= 40,
    'vat.ratePct': (v) => typeof v === 'number' && v >= 0 && v <= 100,
};
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// What can only be confirmed by a person before plan billing is switched on.
const LAUNCH_GATES = ['providerApproved', 'pricingApproved', 'legalCleared', 'termsReviewed', 'liveTestPassed'];

/** What still stands between Bookplus and charging businesses for their plan. */
const launchChecklist = (settings) => {
    const items = LAUNCH_GATES.map((g) => ({
        key: g,
        done: !!settings.launch?.[g]?.at,
        at: settings.launch?.[g]?.at || null,
        by: settings.launch?.[g]?.by || null,
        note: settings.launch?.[g]?.note || '',
    }));
    return { ready: items.every((i) => i.done), items };
};

const settingsPayload = (settings, user) => ({ settings, launch: launchChecklist(settings), me: { roles: financeRolesOf(user) } });

// POST /api/admin/finance/paygate-check — are the server's PayGate settings
// right? Opens a test session that is never paid (services/paygateCheck).
exports.paygateCheck = async (req, res) => {
    try {
        const result = await require('../services/paygateCheck').runCheck({ adminEmail: req.user.email });
        await recordFinance({
            actor: req.user, action: 'paygate.check',
            details: { ready: result.ready, items: result.items.map((i) => ({ key: i.key, status: i.status })) },
        });
        res.json({ success: true, data: { ...result, checkedAt: new Date() } });
    } catch (err) {
        logger.error({ err: err.message }, 'PayGate check failed');
        fail(res, 500, 'Internal server error');
    }
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

// { plans: { basic: { priceCents: 14999 } } } → { 'plans.basic.priceCents': 14999 }.
// Requests carry nested objects: the request sanitizer drops dotted keys.
const flatten = (obj, prefix = '', out = {}) => {
    for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
        else out[path] = v;
    }
    return out;
};

// PUT /api/admin/finance/settings { changes: { plans: { basic: { priceCents: 14999 } }, ... }, reason }
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
            const v = typeof value === 'string' && path !== 'vat.number' && !path.endsWith('.label') ? Number(value) : value;
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

exports._test = { EDITABLE, launchChecklist, hasFinanceRole, flatten };
