const express = require('express');
const router = express.Router();
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
    becomeProvider,
    changePassword,
    verifyEmail,
    resendVerification,
    exchangeOAuthCode,
    forgotPassword,
    resetPassword,
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
router.put('/become-provider', auth, becomeProvider);
router.put('/change-password', auth, changePassword);
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

// Google redirects here — issue a short-lived one-time code; client exchanges it for tokens
router.get('/google/callback',
    passport.authenticate('google', {
        failureRedirect: `${process.env.CLIENT_URL}/login?error=google_failed`,
        session: false,
    }),
    async (req, res) => {
        try {
            const code = crypto.randomBytes(32).toString('hex');
            const codeHash = crypto.createHash('sha256').update(code).digest('hex');
            await User.findByIdAndUpdate(req.user._id, {
                oauthCode: codeHash,
                oauthCodeExpiry: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
            });
            res.redirect(`${process.env.CLIENT_URL}/auth/callback?code=${code}`);
        } catch (err) {
            res.redirect(`${process.env.CLIENT_URL}/login?error=google_failed`);
        }
    }
);

module.exports = router;