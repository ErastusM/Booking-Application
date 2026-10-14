/**
 * /api/payments/onboarding — a business applies to take online payments
 * (payment specification, section 6): it chooses a plan with every cost shown,
 * gives its legal details, uploads its documents (privately), adds its payout
 * bank account, accepts the terms and sends it. Bookplus reviews it
 * (financeController approvals). Once approved, the business switches online
 * payments on or off itself.
 *
 * Owner only (the business account itself, never staff or admins).
 */
const mongoose = require('mongoose');
const pino = require('pino');
const User = require('../models/User');
const pricing = require('../services/pricing');
const rules = require('../services/paymentsApproval');
const cloudinary = require('../utils/cloudinary');
const { recordFinance } = require('../utils/financeAudit');
const { notifyAdmins } = require('../utils/notificationhelper');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const fail = (res, status, message, code) => res.status(status).json({ success: false, ...(code ? { code } : {}), message });

const load = (id) => User.findById(id).select('+paymentsApproval +payoutAccount');
const hasPayout = (u) => !!(u?.payoutAccount && u.payoutAccount.accountNumber && u.payoutAccount.bankName);

// What each plan costs, in full, from the current settings.
const plansOffered = (settings) => ['basic', 'standard'].map((key) => {
    const p = settings.plans[key];
    return {
        key,
        label: p.label,
        trialDays: p.trialDays || 0,
        introMonths: p.introMonths || 0,
        introPriceCents: p.introPriceCents || 0,
        priceCents: p.priceCents || 0,
        priceChangeNoticeDays: p.priceChangeNoticeDays || 0,
        commissionBps: p.commissionBps,
        fixedFeeCents: p.fixedFeeCents,
    };
});
const processingFeeOffered = (settings) => {
    const pf = settings.processingFee || {};
    const known = Number.isFinite(pf.bps) || Number.isFinite(pf.fixedCents);
    return { known, bps: known ? pf.bps || 0 : null, fixedCents: known ? pf.fixedCents || 0 : null, payer: pf.payer || 'business' };
};

const payload = async (user) => {
    const settings = await pricing.getSettings();
    const approval = user.paymentsApproval || {};
    const missing = rules.missingFor(approval, { hasPayoutAccount: hasPayout(user) });
    return {
        ...rules.ownerView(approval),
        missing,
        canSubmit: rules.isEditable(approval) && rules.statusOf(approval) !== 'submitted' && missing.length === 0,
        hasPayoutAccount: hasPayout(user),
        uploadsAvailable: cloudinary.isConfigured(),
        plans: plansOffered(settings),
        processingFee: processingFeeOffered(settings),
        payout: { frequency: settings.payout?.frequency || 'weekly', weekday: settings.payout?.weekday ?? 5 },
        maxDocuments: rules.MAX_DOCS,
    };
};

// Moves a rejected application back to a draft when the business edits it.
const reopenIfRejected = (user) => {
    if (rules.statusOf(user.paymentsApproval) === 'rejected') {
        user.paymentsApproval.status = 'draft';
        user.paymentsApproval.history.push({ status: 'draft', at: new Date(), by: user._id, note: 'Started again after a rejection' });
    }
};

// GET /api/payments/onboarding
exports.getOnboarding = async (req, res) => {
    try {
        const user = await load(req.user._id);
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, data: await payload(user) });
    } catch (err) {
        logger.error({ err: err.message }, 'onboarding read failed');
        fail(res, 500, 'Internal server error');
    }
};

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

// PUT /api/payments/onboarding { plan?, legal?: { businessType, registeredName, registrationNumber, ownerName, ownerIdNumber } }
exports.updateOnboarding = async (req, res) => {
    try {
        const user = await load(req.user._id);
        if (!user.paymentsApproval) user.paymentsApproval = { status: 'draft', history: [] };
        if (!rules.isEditable(user.paymentsApproval)) {
            return fail(res, 409, 'Your application is with Bookplus. It can be changed again if Bookplus asks for more.', 'not_editable');
        }
        const { plan, legal } = req.body || {};
        const a = user.paymentsApproval;
        if (plan !== undefined) {
            if (!['basic', 'standard'].includes(plan)) return fail(res, 400, 'Choose Basic or Standard', 'bad_plan');
            a.plan = plan;
        }
        if (legal !== undefined) {
            if (!legal || typeof legal !== 'object') return fail(res, 400, 'Send your details', 'bad_details');
            if (legal.businessType !== undefined) {
                if (!rules.BUSINESS_TYPES.includes(legal.businessType)) return fail(res, 400, 'Choose what kind of business it is', 'bad_business_type');
                a.legal.businessType = legal.businessType;
            }
            const fields = { registeredName: 120, registrationNumber: 40, ownerName: 100, ownerIdNumber: 30 };
            for (const [k, max] of Object.entries(fields)) {
                const v = text(legal[k], max);
                if (v === undefined) continue;
                if (k === 'ownerIdNumber' && v && !/^[A-Za-z0-9 -]{5,30}$/.test(v)) {
                    return fail(res, 400, 'Enter the ID or passport number as it appears on the document', 'bad_id_number');
                }
                a.legal[k] = v;
            }
        }
        reopenIfRejected(user);
        await user.save();
        res.json({ success: true, data: await payload(user) });
    } catch (err) {
        logger.error({ err: err.message }, 'onboarding update failed');
        fail(res, 500, 'Internal server error');
    }
};

// POST /api/payments/onboarding/upload — signed parameters for one private upload
exports.uploadParams = async (req, res) => {
    if (!cloudinary.isConfigured()) {
        return fail(res, 503, 'Uploading documents is unavailable right now. Please try again later.', 'uploads_unavailable');
    }
    const user = await load(req.user._id);
    if (user.paymentsApproval && !rules.isEditable(user.paymentsApproval)) {
        return fail(res, 409, 'Your application is with Bookplus.', 'not_editable');
    }
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: cloudinary.verificationUploadParams(req.user._id) });
};

// POST /api/payments/onboarding/documents { kind, name, ref: { publicId, resourceType, format } }
exports.addDocument = async (req, res) => {
    try {
        const { kind, name, ref } = req.body || {};
        if (!rules.DOC_KINDS.includes(kind)) return fail(res, 400, 'Say which document this is', 'bad_kind');
        const clean = cloudinary.cleanVerificationRef(ref, req.user._id);
        if (!clean) return fail(res, 400, 'That upload was not accepted. Upload a PDF, JPG or PNG again.', 'bad_upload');
        const user = await load(req.user._id);
        if (!user.paymentsApproval) user.paymentsApproval = { status: 'draft', history: [] };
        if (!rules.isEditable(user.paymentsApproval)) return fail(res, 409, 'Your application is with Bookplus.', 'not_editable');
        const docs = user.paymentsApproval.documents;
        if (docs.length >= rules.MAX_DOCS) return fail(res, 409, `At most ${rules.MAX_DOCS} documents. Remove one first.`, 'too_many_documents');
        if (docs.some((d) => d.publicId === clean.publicId)) return fail(res, 409, 'That file is already attached.', 'duplicate_document');
        docs.push({ kind, name: text(name, 120) || '', ...clean, uploadedAt: new Date() });
        reopenIfRejected(user);
        await user.save();
        res.status(201).json({ success: true, data: await payload(user) });
    } catch (err) {
        logger.error({ err: err.message }, 'onboarding document add failed');
        fail(res, 500, 'Internal server error');
    }
};

// DELETE /api/payments/onboarding/documents/:docId
exports.removeDocument = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.docId)) return fail(res, 404, 'Document not found');
        const user = await load(req.user._id);
        const a = user.paymentsApproval;
        if (!a) return fail(res, 404, 'Document not found');
        if (!rules.isEditable(a)) return fail(res, 409, 'Your application is with Bookplus.', 'not_editable');
        const doc = a.documents.id(req.params.docId);
        if (!doc) return fail(res, 404, 'Document not found');
        const gone = { publicId: doc.publicId, resourceType: doc.resourceType, deliveryType: doc.deliveryType };
        doc.deleteOne();
        await user.save();
        if (cloudinary.isConfigured()) {
            cloudinary.destroy({ publicId: gone.publicId, resourceType: gone.resourceType, type: gone.deliveryType }).catch(() => {});
        }
        res.json({ success: true, data: await payload(user) });
    } catch (err) {
        logger.error({ err: err.message }, 'onboarding document remove failed');
        fail(res, 500, 'Internal server error');
    }
};

// POST /api/payments/onboarding/submit { acceptTerms: true }
exports.submit = async (req, res) => {
    try {
        if (req.body?.acceptTerms !== true) {
            return fail(res, 400, 'Accept the online payments terms to send your application', 'terms_required');
        }
        const user = await load(req.user._id);
        const a = user.paymentsApproval;
        if (!a || !rules.isEditable(a)) return fail(res, 409, 'There is nothing to send, or it is already with Bookplus.', 'not_editable');
        const missing = rules.missingFor(a, { hasPayoutAccount: hasPayout(user) });
        if (missing.length) return res.status(400).json({ success: false, code: 'incomplete', message: 'Some details or documents are still missing.', missing });
        // Atomic: two quick taps can't send it twice.
        const from = a.status;
        const now = new Date();
        const r = await User.updateOne(
            { _id: user._id, 'paymentsApproval.status': from },
            {
                $set: { 'paymentsApproval.status': 'submitted', 'paymentsApproval.submittedAt': now, 'paymentsApproval.termsAcceptedAt': now },
                $push: { 'paymentsApproval.history': { status: 'submitted', at: now, by: user._id, note: '' } },
            },
        );
        if (r.modifiedCount !== 1) return fail(res, 409, 'It is already with Bookplus.', 'not_editable');
        await recordFinance({
            actor: req.user, action: 'approval.submit', provider: user._id,
            reference: a.plan, reason: from === 'info_requested' ? 'Sent again with what Bookplus asked for' : '',
        });
        const name = user.businessProfile?.businessName || user.name;
        notifyAdmins(`${name} applied to take online payments`, 'system', '/bkplus-command').catch(() => {});
        const fresh = await load(req.user._id);
        res.json({ success: true, message: 'Sent to Bookplus', data: await payload(fresh) });
    } catch (err) {
        logger.error({ err: err.message }, 'onboarding submit failed');
        fail(res, 500, 'Internal server error');
    }
};

// PUT /api/payments/onboarding/switch { on: true|false } — the business's own switch
exports.setSwitch = async (req, res) => {
    try {
        const on = req.body?.on;
        if (typeof on !== 'boolean') return fail(res, 400, 'on must be true or false');
        const user = await load(req.user._id);
        const a = user.paymentsApproval;
        if (rules.statusOf(a) !== 'approved') return fail(res, 409, 'Online payments can be switched on once Bookplus has approved your business.', 'not_approved');
        if (on && a.adminOff) return fail(res, 409, 'Bookplus has switched online payments off for your business. Contact Bookplus.', 'admin_off');
        await User.updateOne({ _id: user._id }, { $set: { 'paymentsApproval.switchOn': on } });
        await recordFinance({ actor: req.user, action: on ? 'payments.switch_on' : 'payments.switch_off', provider: user._id });
        const fresh = await load(req.user._id);
        res.json({ success: true, data: await payload(fresh) });
    } catch (err) {
        logger.error({ err: err.message }, 'onboarding switch failed');
        fail(res, 500, 'Internal server error');
    }
};

exports._test = { plansOffered };
