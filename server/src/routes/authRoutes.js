const express = require('express');
const router = express.Router();
const {
    register,
    login,
    logout,
    getProfile,
    updateProfile
} = require('../controllers/authController');
const { auth } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/logout', auth, logout);
router.get('/profile', auth, getProfile);
router.put('/profile', auth, updateProfile);

const passport = require('../config/passport');
const { generateToken, generateRefreshToken } = require('../utils/helpers');

// Kick off Google OAuth
router.get('/google',
    passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

// Google redirects here
router.get('/google/callback',
    (req, res, next) => {
        console.log('✅ Google callback hit');
        console.log('Query params:', req.query);
        next();
    },
    passport.authenticate('google', {
        failureRedirect: `${process.env.CLIENT_URL}/login?error=google_failed`,
        session: false,
        failureMessage: true,
    }),
    (req, res) => {
        console.log('✅ Passport auth passed');
        console.log('User:', req.user);
        try {
            const token = generateToken(req.user._id);
            const refreshToken = generateRefreshToken(req.user._id);
            const redirectUrl = `${process.env.CLIENT_URL}/auth/callback` +
                `?token=${token}` +
                `&refreshToken=${refreshToken}` +
                `&id=${req.user._id}` +
                `&role=${req.user.role}` +
                `&name=${encodeURIComponent(req.user.name)}` +
                `&email=${encodeURIComponent(req.user.email)}` +
                `&avatar=${encodeURIComponent(req.user.avatar || '')}`;
            console.log('✅ Redirecting to:', redirectUrl);
            res.redirect(redirectUrl);
        } catch (err) {
            console.error('❌ Error in callback handler:', err.message);
            res.redirect(`${process.env.CLIENT_URL}/login?error=google_failed`);
        }
    }
);

module.exports = router;