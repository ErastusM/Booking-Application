const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.auth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, message: 'No token, authorization denied' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id);

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

        if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== req.user.tokenVersion) {
            return res.status(401).json({ success: false, message: 'Token has been revoked' });
        }

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

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        // Only attach a fully-valid, active, non-revoked session; otherwise stay anonymous.
        if (user && user.isActive !== false &&
            !(decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.tokenVersion)) {
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
// one-line, independently-revertable change; with default staffTier=null a staff
// member holds only the self-baseline, so a swap can never silently open a route.
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
exports.allow = ({ roles = [], capability } = {}) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (roles.includes(req.user.role) || (capability && can(req.user, capability))) {
        return next();
    }
    return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route`,
    });
};
