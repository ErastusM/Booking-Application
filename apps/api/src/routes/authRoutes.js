const express = require('express');
const router = express.Router();
const { primaryOrigin, businessOrigin, originForRole } = require('../utils/origins');
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

router.post('/register', registerRules, register);
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
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/exchange-code', exchangeCodeRules, exchangeOAuthCode);

const passport = require('../config/passport');

// Kick off Google OAuth — carry the chosen role (provider/customer) via OAuth state
router.get('/google', (req, res, next) => {
    const role = req.query.role === 'provider' ? 'provider' : 'customer';
    passport.authenticate('google', { scope: ['profile', 'email'], session: false, state: role })(req, res, next);
});

// Google redirects here — issue a short-lived one-time code; client exchanges it
// for tokens. The redirect must return to the app the sign-in targeted: a
// business ("List your business" → state=provider) goes back to the business
// app, not the customer site. A custom callback lets BOTH the success and the
// failure paths honour that origin.
router.get('/google/callback', (req, res, next) => {
    // `state` carries the role chosen at /google; use it for the failure origin
    // (auth failed → no user to read a role from).
    const stateOrigin = req.query.state === 'provider' ? businessOrigin() : primaryOrigin();
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