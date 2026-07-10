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
            return res.status(404).json({ success: false, message: 'User not found' });
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
