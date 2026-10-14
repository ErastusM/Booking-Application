/**
 * The one way to write a financial audit entry (models/FinancialAuditLog.js).
 * Throws on failure: a money action that can't be recorded must not go ahead,
 * so callers await this before (or as part of) acting.
 */
const FinancialAuditLog = require('../models/FinancialAuditLog');
const { financeRolesOf } = require('./financeRoles');

const roleLabel = (actor) => {
    if (!actor) return 'system';
    if (actor.role === 'admin') {
        const roles = financeRolesOf(actor);
        return roles.includes('director') ? 'director' : roles.includes('finance') ? 'finance' : 'admin';
    }
    return actor.role || null;
};

/**
 * @param {object} e
 * @param {object|null} e.actor   the signed-in user (null = the system)
 * @param {string} e.action       e.g. 'settings.update', 'refund.request', 'refund.approve', 'payout.record'
 */
const recordFinance = async ({
    actor = null, action, amountCents = null, currency = 'NAD', provider = null, appointment = null, payment = null,
    reference = '', reason = '', approvalStatus = 'not_required', request = null, details = null,
}) => FinancialAuditLog.create({
    actor: actor?._id || null,
    actorRole: roleLabel(actor),
    action,
    amountCents,
    currency,
    provider,
    appointment,
    payment,
    reference: String(reference || '').slice(0, 120),
    reason: String(reason || '').slice(0, 1000),
    approvalStatus,
    request,
    details,
});

module.exports = { recordFinance };
