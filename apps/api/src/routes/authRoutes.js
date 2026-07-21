const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { primaryOrigin, businessOrigin, originForRole } = require('../utils/origins');
const { buildState, roleFromState, cookieHeader, clearCookieHeader, verifyState } = require('../utils/oauthState');
const crypto = require('crypto');
const {
    register,
    login,
    logout,
    refresh,
    getProfile,
    updateProfile,
    updatePortfolio,
    completeProviderSetup,
    generateBookingSlug,
    becomeProvider,
    changePassword,
    verifyEmail,
    resendVerification,
    exchangeOAuthCode,
    forgotPassword,
    resetPassword,
    deactivateAccount,
    deleteAccount,
    blockUser,
    unblockUser,
    getBlockedUsers,
} = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const {
    registerRules,
    loginRules,
    updateProfileRules,
    exchangeCodeRules,
} = require('../middleware/validate');
const User = require('../models/User');

// Registration necessarily tells a real signer-up that an email is already taken —
// that message is good UX and stays. What we deny is SCALE: a per-IP cap makes
// sweeping a list of addresses impractical, which is the actual enumeration risk
// (finding #23). Password reset is capped for the same reason. Generous for a human
// (nobody legitimately registers 20 accounts an hour from one IP), hostile to a script.
const accountProbeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: process.env.NODE_ENV === 'test' ? 10000 : 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many attempts from this connection. Please try again later.' },
});

router.post('/register', accountProbeLimiter, registerRules, register);
router.post('/login', loginRules, login);
router.post('/logout', auth, logout);
router.post('/refresh', refresh);
router.get('/profile', auth, getProfile);
router.put('/profile', auth, updateProfileRules, updateProfile);
router.put('/portfolio', auth, updatePortfolio);
router.post('/provider-setup', auth, completeProviderSetup);
router.post('/booking-slug', auth, generateBookingSlug);
router.put('/become-provider', auth, becomeProvider);
router.put('/change-password', auth, changePassword);
router.post('/deactivate', auth, deactivateAccount);
router.delete('/account', auth, deleteAccount);
router.get('/blocked-users', auth, getBlockedUsers);
router.post('/block', auth, blockUser);
router.delete('/block/:userId', auth, unblockUser);
router.post('/forgot-password', accountProbeLimiter, forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/exchange-code', exchangeCodeRules, exchangeOAuthCode);

const passport = require('../config/passport');

// Kick off Google OAuth — carry the chosen role (provider/customer) via OAuth state
router.get('/google', (req, res, next) => {
    const role = req.query.role === 'provider' ? 'provider' : 'customer';
    // Bind this flow to THIS browser: the nonce goes out in `state` and into an
    // HttpOnly cookie, and the callback below refuses any state without a matching
    // cookie. Without it the callback accepted any code from any browser (#13).
    const { state, nonce } = buildState(role);
    res.setHeader('Set-Cookie', cookieHeader(nonce));
    passport.authenticate('google', { scope: ['profile', 'email'], session: false, state })(req, res, next);
});

// Google redirects here — issue a short-lived one-time code; client exchanges it
// for tokens. The redirect must return to the app the sign-in targeted: a
// business ("List your business" → state=provider) goes back to the business
// app, not the customer site. A custom callback lets BOTH the success and the
// failure paths honour that origin.
router.get('/google/callback', (req, res, next) => {
    // `state` carries the role chosen at /google; use it for the failure origin
    // (auth failed → no user to read a role from).
    const stateOrigin = roleFromState(req.query.state) === 'provider' ? businessOrigin() : primaryOrigin();
    // Reject a callback that did not originate from a flow this browser started —
    // the login-CSRF gate. Always clear the one-shot cookie either way.
    if (!verifyState(req)) {
        res.setHeader('Set-Cookie', clearCookieHeader());
        return res.redirect(`${stateOrigin}/login?error=google_failed`);
    }
    res.setHeader('Set-Cookie', clearCookieHeader());
    passport.authenticate('google', { session: false }, async (err, user) => {
        if (err || !user) {
            return res.redirect(`${stateOrigin}/login?error=google_failed`);
        }
        try {
            const code = crypto.randomBytes(32).toString('hex');
            const codeHash = crypto.createHash('sha256').update(code).digest('hex');
            await User.findByIdAndUpdate(user._id, {
                oauthCode: codeHash,
                oauthCodeExpiry: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
            });
            // On success, use the authenticated account's real role.
            return res.redirect(`${originForRole(user.role)}/auth/callback?code=${code}`);
        } catch (e) {
            return res.redirect(`${stateOrigin}/login?error=google_failed`);
        }
    })(req, res, next);
});

module.exports = router;