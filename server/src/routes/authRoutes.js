const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const {
    register,
    login,
    logout,
    getProfile,
    updateProfile,
    verifyEmail,
    exchangeOAuthCode,
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
router.get('/profile', auth, getProfile);
router.put('/profile', auth, updateProfileRules, updateProfile);
router.get('/verify-email', verifyEmail);
router.post('/exchange-code', exchangeCodeRules, exchangeOAuthCode);

const passport = require('../config/passport');

// Kick off Google OAuth
router.get('/google',
    passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

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