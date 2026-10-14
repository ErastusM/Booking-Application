/**
 * Bookplus staff money roles (payment specification, section 7):
 *
 *   finance   view transactions and settlements, prepare refunds, see payout
 *             information, reconcile payments, record payouts
 *   director  everything finance can, plus approve refunds and adjustments and
 *             change the financial settings (prices, fees, approvals, launch)
 *
 * Only admin accounts hold them, and only in a session that passed two-step
 * sign-in in the last MFA_SESSION_HOURS (12 by default). Business accounts never reach these controls. An admin created
 * before roles existed (no adminRoles set) holds both, so the owner's existing
 * admin keeps working; once any role is set, only the roles listed count.
 */
const { sessionFresh } = require('./mfa');

const FINANCE_ROLES = ['finance', 'director'];

const financeRolesOf = (user) => {
    if (!user || user.role !== 'admin') return [];
    const set = Array.isArray(user.adminRoles) ? user.adminRoles.filter((r) => FINANCE_ROLES.includes(r)) : [];
    return set.length ? set : [...FINANCE_ROLES];
};

const hasFinanceRole = (user, role) => {
    const roles = financeRolesOf(user);
    if (role === 'finance') return roles.includes('finance') || roles.includes('director');
    return roles.includes(role);
};

/**
 * Route guard. `role` is 'finance' (directors pass too) or 'director'.
 * Needs `auth` before it. No two-step sign-in on the account: 403
 * 'mfa_setup_required'; on, but not confirmed recently in this session: 403
 * 'mfa_required' (the admin panel then asks for a code).
 */
const requireFinance = (role = 'finance') => (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Not authorised' });
    }
    if (!req.user.mfa?.enabled) {
        return res.status(403).json({
            success: false,
            code: 'mfa_setup_required',
            message: 'Money controls need two-step sign-in. Set it up first.',
        });
    }
    if (!sessionFresh(req.authClaims)) {
        return res.status(403).json({
            success: false,
            code: 'mfa_required',
            message: 'Enter the code from your authenticator app to use the money controls.',
        });
    }
    if (!hasFinanceRole(req.user, role)) {
        return res.status(403).json({ success: false, code: 'finance_role_required', message: `This needs the ${role} role.` });
    }
    next();
};

module.exports = { FINANCE_ROLES, financeRolesOf, hasFinanceRole, requireFinance };
