/**
 * The rules for a business's online payments application (payment
 * specification, section 6). Pure functions over the stored record
 * (User.paymentsApproval) so the controllers and tests share one definition.
 *
 *   draft ──submit──▶ submitted ──▶ approved
 *     ▲                   │  └────▶ rejected ──edit──▶ draft
 *     └──── edit ── info_requested ◀┘
 *
 * A business can change its application only while it is a draft, after
 * Bookplus asked for more, or after a rejection. Once approved, it takes online
 * payments only while its own switch is on and Bookplus hasn't switched it off.
 */
const STATUSES = ['draft', 'submitted', 'info_requested', 'approved', 'rejected'];
const EDITABLE = ['draft', 'info_requested', 'rejected'];
const BUSINESS_TYPES = ['sole_trader', 'cc', 'company', 'other'];
const DOC_KINDS = ['owner_id', 'registration', 'bank_letter', 'other'];
const MAX_DOCS = 8;

const statusOf = (approval) => (approval && STATUSES.includes(approval.status) ? approval.status : 'draft');
const isEditable = (approval) => EDITABLE.includes(statusOf(approval));

// A sole trader has no company registration; everyone else uploads it.
const needsRegistration = (approval) => (approval?.legal?.businessType || null) !== 'sole_trader';

/** What is still missing before the application can be sent, as keys. */
const missingFor = (approval, { hasPayoutAccount = false } = {}) => {
    const a = approval || {};
    const legal = a.legal || {};
    const docs = Array.isArray(a.documents) ? a.documents : [];
    const has = (kind) => docs.some((d) => d.kind === kind);
    const missing = [];
    if (!['basic', 'standard'].includes(a.plan)) missing.push('plan');
    if (!BUSINESS_TYPES.includes(legal.businessType)) missing.push('businessType');
    if (!legal.registeredName) missing.push('registeredName');
    if (needsRegistration(a) && !legal.registrationNumber) missing.push('registrationNumber');
    if (!legal.ownerName) missing.push('ownerName');
    if (!legal.ownerIdNumber) missing.push('ownerIdNumber');
    if (!has('owner_id')) missing.push('doc_owner_id');
    if (needsRegistration(a) && !has('registration')) missing.push('doc_registration');
    if (!has('bank_letter')) missing.push('doc_bank_letter');
    if (!hasPayoutAccount) missing.push('payoutAccount');
    return missing;
};

/** May this business take online payments right now? */
const canTakePayments = (approval) => {
    const a = approval || {};
    return statusOf(a) === 'approved' && a.switchOn === true && a.adminOff !== true;
};

const mask = (v) => {
    const s = String(v || '');
    if (!s) return '';
    return s.length <= 3 ? '•••' : `${'•'.repeat(Math.min(8, s.length - 3))}${s.slice(-3)}`;
};

const docRow = (d) => ({ _id: d._id, kind: d.kind, name: d.name || '', format: d.format || '', uploadedAt: d.uploadedAt || null });

/** The application as its own business sees it (ID number masked). */
const ownerView = (approval) => {
    const a = approval || {};
    const legal = a.legal || {};
    return {
        status: statusOf(a),
        plan: a.plan || null,
        legal: {
            businessType: legal.businessType || null,
            registeredName: legal.registeredName || '',
            registrationNumber: legal.registrationNumber || '',
            ownerName: legal.ownerName || '',
            ownerIdNumberMasked: mask(legal.ownerIdNumber),
            hasOwnerIdNumber: !!legal.ownerIdNumber,
        },
        documents: (a.documents || []).map(docRow),
        submittedAt: a.submittedAt || null,
        decidedAt: a.decidedAt || null,
        decisionNote: a.decisionNote || '',
        switchOn: !!a.switchOn,
        adminOff: !!a.adminOff,
        adminOffReason: a.adminOff ? a.adminOffReason || '' : '',
        payoutAccountReviewNeeded: !!a.payoutAccountReviewNeeded,
        editable: isEditable(a),
        takingPayments: canTakePayments(a),
    };
};

/** The application as Bookplus's reviewers see it (full details). */
const reviewView = (approval) => {
    const a = approval || {};
    return {
        ...ownerView(a),
        legal: { ...(a.legal || {}) },
        history: a.history || [],
    };
};

module.exports = {
    STATUSES, EDITABLE, BUSINESS_TYPES, DOC_KINDS, MAX_DOCS,
    statusOf, isEditable, needsRegistration, missingFor, canTakePayments, ownerView, reviewView, mask,
};
