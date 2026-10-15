const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { teamBusinessSuspended, TEAM_SUSPENDED_MESSAGE } = require('../utils/publicProvider');
const { sessionFresh } = require('../utils/mfa');
const { tokenRevoked } = require('../utils/helpers');

// Session tokens are only ever HS256 (utils/helpers.generateToken).
const VERIFY_OPTIONS = { algorithms: ['HS256'] };
exports.verifySessionToken = (token) => jwt.verify(token, process.env.JWT_SECRET, VERIFY_OPTIONS);

// An admin account can delete users, make admins, move wallet money and see
// every business, so every admin request needs a session that passed two-step
// sign-in in the last MFA_SESSION_HOURS (utils/mfa). Before that, an admin can
// only set it up or enter a code, read their own profile and sign out.
const ADMIN_BEFORE_TWO_STEP = new Set([
    'GET /api/auth/mfa',
    'POST /api/auth/mfa/setup',
    'POST /api/auth/mfa/enable',
    'POST /api/auth/mfa/confirm',
    'GET /api/auth/profile',
    'POST /api/auth/logout',
]);
const adminTwoStepBlock = (req, user, claims) => {
    if (user.role !== 'admin') return null;
    const path = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
    if (ADMIN_BEFORE_TWO_STEP.has(`${req.method} ${path}`)) return null;
    if (!user.mfa?.enabled) {
        return { code: 'mfa_setup_required', message: 'Admin accounts need two-step sign-in. Set it up first.' };
    }
    if (!sessionFresh(claims)) {
        return { code: 'mfa_required', message: 'Enter the code from your authenticator app to continue.' };
    }
    return null;
};

exports.auth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, message: 'No token, authorization denied' });
        }

        const decoded = exports.verifySessionToken(token);
        req.user = await User.findById(decoded.id);
        // What this session proved (e.g. two-step sign-in: utils/financeRoles).
        req.authClaims = decoded;

        if (!req.user) {
            // A valid token whose user no longer exists (deleted/pruned account, or
            // a full data reset) is an AUTHENTICATION failure — return 401, not 404,
            // so the client's refresh/logout interceptor cleanly ends the dead
            // session instead of stranding the UI on "failed to load…".
            return res.status(401).json({ success: false, message: 'Session no longer valid' });
        }

        if (req.user.isActive === false) {
            return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact support.' });
        }

        if (tokenRevoked(decoded, req.user)) {
            return res.status(401).json({ success: false, message: 'Token has been revoked' });
        }

        // A team login is closed while an admin has its business suspended.
        if (await teamBusinessSuspended(req.user)) {
            return res.status(403).json({ success: false, code: 'business_suspended', message: TEAM_SUSPENDED_MESSAGE });
        }

        const twoStep = adminTwoStepBlock(req, req.user, decoded);
        if (twoStep) return res.status(403).json({ success: false, ...twoStep });

        next();
    } catch (error) {
        res.status(401).json({ success: false, message: 'Token is not valid' });
    }
};

// Like `auth`, but never rejects: a valid token hydrates req.user, anything else
// (missing/invalid/expired token, unknown/suspended user) leaves req.user = null.
// For routes that serve BOTH signed-in and guest visitors (e.g. guest checkout).
exports.optionalAuth = async (req, res, next) => {
    req.user = null;
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return next();

        const decoded = exports.verifySessionToken(token);
        const user = await User.findById(decoded.id);
        // Only attach a fully-valid, active, non-revoked session (for an admin,
        // one that passed two-step sign-in); otherwise stay anonymous.
        if (user && user.isActive !== false &&
            !tokenRevoked(decoded, user) &&
            !adminTwoStepBlock(req, user, decoded) &&
            !(await teamBusinessSuspended(user))) {
            req.user = user;
        }
    } catch {
        // Malformed/expired token → treat as a guest, don't error.
    }
    next();
};

exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `User role '${req.user.role}' is not authorized to access this route`
            });
        }
        next();
    };
};

const { can } = require('../utils/permissions');

// Capability gate. Runs AFTER auth (req.user hydrated). Because can() returns
// true for provider/admin, this transparently preserves owner/admin access and
// only ADDS a staff path for members whose tier grants the capability. Swapping
// `authorize('provider','admin')` → `requireCapability('<cap>')` on a route is a
// one-line, independently-revertable change. Every team member holds the same
// member set (utils/permissions MEMBER): their own calendar, bookings, clients
// and blocked time — nothing business-wide.
exports.requireCapability = (capability) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (!can(req.user, capability)) {
        return res.status(403).json({ success: false, message: 'You do not have permission to do that' });
    }
    next();
};

// For customer-inclusive routes (cancel/reschedule/waitlist/…): pass if the
// user's role is in `roles` OR they hold `capability`. Keeps the customer/owner
// paths exactly as they were while adding a capability-gated staff path.
// `capability` may be a list — holding ANY of them passes (e.g. blocked-time
// writes: calendar:manage for the whole business, calendar:block:self for a
// member's own lane, with the controller enforcing the lane).
exports.allow = ({ roles = [], capability } = {}) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const caps = capability ? [].concat(capability) : [];
    if (roles.includes(req.user.role) || caps.some((c) => can(req.user, c))) {
        return next();
    }
    return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route`,
    });
};
