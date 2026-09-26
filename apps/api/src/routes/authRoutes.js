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
    submitSignupSurvey,
    updatePortfolio,
    completeProviderSetup,
    generateBookingSlug,
    becomeProvider,
    getSibling,
    switchSide,
    addCustomerAccount,
    changePassword,
    verifyEmail,
    resendVerification,
    exchangeOAuthCode,
    forgotPassword,
    resetPassword,
    getStaffInvite,
    acceptStaffInvite,
    renewStaffInvite,
    requestStaffInvite,
    deactivateAccount,
    deleteAccount,
    blockUser,
    unblockUser,
    getBlockedUsers,
    setMarketingEmails,
    exportAccount,
    getGoogleSignup,
    completeGoogleSignup,
} = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const { createInviteRequestLimiter } = require('../middleware/authRateLimit');
const {
    registerRules,
    loginRules,
    updateProfileRules,
    exchangeCodeRules,
} = require('../middleware/validate');
const User = require('../models/User');
const PendingSignup = require('../models/PendingSignup');

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
router.post('/signup-survey', auth, submitSignupSurvey);
router.put('/portfolio', auth, updatePortfolio);
router.post('/provider-setup', auth, completeProviderSetup);
router.post('/booking-slug', auth, generateBookingSlug);
router.put('/become-provider', auth, becomeProvider);
// Account switcher (both navbars).
router.get('/sibling', auth, getSibling);
router.post('/switch-side', auth, switchSide);
router.post('/add-customer-account', auth, addCustomerAccount);
router.put('/change-password', auth, changePassword);
router.post('/deactivate', auth, deactivateAccount);
router.delete('/account', auth, deleteAccount);
router.get('/account/export', auth, exportAccount);
router.get('/blocked-users', auth, getBlockedUsers);
router.put('/marketing', auth, setMarketingEmails);
router.post('/block', auth, blockUser);
router.delete('/block/:userId', auth, unblockUser);
router.post('/forgot-password', accountProbeLimiter, forgotPassword);
router.post('/reset-password', resetPassword);
// Staff invite acceptance (Fresha-style): preview the invite, then set a
// password and get signed straight in. Public — the token is the credential.
// Rate-limited like the other token flows against brute-forcing the token.
router.get('/staff-invite/:token', getStaffInvite);
router.post('/staff-invite/:token/accept', accountProbeLimiter, acceptStaffInvite);
// "Email me a new link" from the invite page (expired / superseded / unknown
// token). Always the same generic 200, answered before any lookup. Their own
// limiter (IP + email/token, plus a per-IP ceiling) — NOT accountProbeLimiter,
// whose 20/h per IP is shared with register, forgot-password and accept: a
// salon's members asking for links on shared Wi-Fi would otherwise 429 the next
// member's accept. The per-account cooldown (2 min, 5/day) in utils/staffInvites
// bounds what is actually emailed to a member or their owner.
const inviteRequestLimiter = createInviteRequestLimiter({ enabled: process.env.NODE_ENV !== 'test' });
router.post('/staff-invite/request', inviteRequestLimiter, requestStaffInvite);
router.post('/staff-invite/:token/renew', inviteRequestLimiter, renewStaffInvite);
router.get('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/exchange-code', exchangeCodeRules, exchangeOAuthCode);
// First-time Google sign-in: read the parked profile, then create the account
// only once Terms/Privacy and the age confirmation are accepted.
router.post('/google/pending', exchangeCodeRules, getGoogleSignup);
router.post('/google/complete', accountProbeLimiter, exchangeCodeRules, completeGoogleSignup);

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
            // First-time Google sign-in: no account yet. Send them to the app's
            // "Finish signing up" step (Terms, Privacy Policy, age) with a one-time
            // code for the parked Google profile.
            if (user.pendingSignup) {
                await PendingSignup.updateOne({ _id: user.id }, { $set: { codeHash } });
                return res.redirect(`${originForRole(user.role)}/auth/callback?signup=${code}`);
            }
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