const User = require('../models/User');
const Category = require('../models/Category');
const { generateToken, generateRefreshToken } = require('../utils/helpers');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sendVerificationEmail, sendWelcomeEmail } = require('../utils/emailService');
const MAIN_CATEGORIES = require('../constants/mainCategories');
const { notifyAdmins } = require('../utils/notificationhelper');

/**
 * =========================
 * REGISTER (LOCAL ONLY)
 * =========================
 */
exports.register = async (req, res) => {
    try {
        const { name, email: rawEmail, password, phone, role, providerCategory } = req.body;
        const email = rawEmail?.trim().toLowerCase();

        // Validate input
        if (!name || !email || !password || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'An account with this email already exists — please sign in instead. One account works as both a customer and a provider.'
            });
        }

        // Password complexity check
        const passwordRegex =
            /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                success: false,
                message:
                    'Password must be at least 8 characters and include an uppercase letter, a number and a special character'
            });
        }

        // Only allow safe roles
        const allowedRoles = ['customer', 'provider'];
        const assignedRole = allowedRoles.includes(role) ? role : 'customer';

        if (assignedRole === 'provider' && (!providerCategory || providerCategory.trim().length === 0)) {
            return res.status(400).json({
                success: false,
                message: 'Please select a valid provider category'
            });
        }
        if (assignedRole === 'provider' && providerCategory.trim().length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Category name is too long'
            });
        }

        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const user = await User.create({
            name,
            email,
            password,
            phone,
            role: assignedRole,
            providerCategory: assignedRole === 'provider' ? providerCategory : null,
            provider: 'local',
            isVerified: false,
            verificationToken,
            verificationTokenExpiry,
            consentedAt: new Date(), // consent captured at sign-up (gated in the UI)
        });

        if (assignedRole === 'provider') {
            await Category.create({
                name: providerCategory,
                provider: user._id,
                order: 1,
            });
        }

        // Fire-and-forget side effects — must never block or hang the signup response.
        // (SMTP can be slow/blocked on the host; the user is already created and gets a token.)
        notifyAdmins(
            `New ${assignedRole} registered: ${name} (${email})`,
            'system',
            '/bkplus-command'
        ).catch((err) => console.error('notifyAdmins failed:', err.message));

        sendVerificationEmail(email, name, verificationToken, assignedRole)
            .catch((err) => console.error('Verification email failed:', err.message));

        const token = generateToken(user._id, user.tokenVersion);
        const refreshToken = generateRefreshToken(user._id, user.tokenVersion);

        res.status(201).json({
            success: true,
            message: 'Registration successful! Please check your email to verify your account.',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    providerCategory: user.providerCategory,
                    isVerified: false,
                },
                token,
                refreshToken,
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Resend the verification email for an unverified account (no auth).
 * Generic response — never reveals whether an email is registered.
 */
exports.resendVerification = async (req, res) => {
    try {
        const email = req.body.email?.trim().toLowerCase();
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
        const user = await User.findOne({ email });
        if (user && !user.isVerified) {
            user.verificationToken = crypto.randomBytes(32).toString('hex');
            user.verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await user.save();
            sendVerificationEmail(user.email, user.name, user.verificationToken, user.role)
                .catch((err) => console.error('Resend verification failed:', err.message));
        }
        res.status(200).json({ success: true, message: 'If that account exists and is unverified, a new verification link is on its way.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * =========================
 * LOGIN (LOCAL ONLY)
 * =========================
 */
exports.login = async (req, res) => {
    try {
        const { email: rawEmail, password } = req.body;
        const email = rawEmail?.trim().toLowerCase();

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide an email and password'
            });
        }

        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const isMatch = await user.matchPassword(password);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        if (user.isActive === false) {
            return res.status(403).json({
                success: false,
                message: 'Your account has been suspended. Please contact support.'
            });
        }

        const token = generateToken(user._id, user.tokenVersion);
        const refreshToken = generateRefreshToken(user._id, user.tokenVersion);

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    providerCategory: user.providerCategory,
                    avatar: user.avatar,
                    phone: user.phone,
                    providerSetupComplete: user.providerSetupComplete,
                },
                token,
                refreshToken
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * =========================
 * EXCHANGE OAUTH CODE
 * =========================
 */
exports.exchangeOAuthCode = async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ success: false, message: 'Code required' });

        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const user = await User.findOne({ oauthCode: codeHash, oauthCodeExpiry: { $gt: new Date() } })
            .select('+oauthCode +oauthCodeExpiry');

        if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired code' });

        user.oauthCode = null;
        user.oauthCodeExpiry = null;
        await user.save();

        const token = generateToken(user._id, user.tokenVersion);
        const refreshToken = generateRefreshToken(user._id, user.tokenVersion);

        res.status(200).json({
            success: true,
            data: {
                token,
                refreshToken,
                user: {
                    _id: user._id,
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    avatar: user.avatar,
                    phone: user.phone,
                    providerCategory: user.providerCategory,
                    providerSetupComplete: user.providerSetupComplete,
                },
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Authentication failed' });
    }
};

/**
 * =========================
 * REFRESH ACCESS TOKEN
 * =========================
 * Exchanges a valid refresh token for a fresh access token (and rotates the
 * refresh token). This is what keeps people signed in: when the short-lived
 * access token expires the client silently refreshes instead of logging out.
 * Refresh tokens carry the user's tokenVersion, so logout / password reset
 * (which bump tokenVersion) revoke them too.
 */
exports.refresh = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ success: false, message: 'Refresh token required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        } catch (err) {
            return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
        }

        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid refresh token' });
        }

        if (user.isActive === false) {
            return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact support.' });
        }

        // Revoked by a logout / password reset since this refresh token was issued
        if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.tokenVersion) {
            return res.status(401).json({ success: false, message: 'Refresh token has been revoked' });
        }

        const token = generateToken(user._id, user.tokenVersion);
        const newRefreshToken = generateRefreshToken(user._id, user.tokenVersion);

        res.status(200).json({
            success: true,
            data: { token, refreshToken: newRefreshToken }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * =========================
 * LOGOUT
 * =========================
 */
exports.logout = async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });
        res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Logout failed' });
    }
};

/**
 * =========================
 * GET PROFILE
 * =========================
 */
exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * =========================
 * UPDATE PROFILE
 * =========================
 */
exports.updateProfile = async (req, res) => {
    try {
        const { name, phone, avatar, providerCategory, address } = req.body;

        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        user.name = name || user.name;
        user.phone = phone || user.phone;
        user.avatar = avatar || user.avatar;
        if (req.body.googleCalendarEmbedUrl !== undefined) user.googleCalendarEmbedUrl = req.body.googleCalendarEmbedUrl.trim();

        if (user.role === 'provider' && address !== undefined) {
            user.businessProfile.address = address.trim();
        }

        if (user.role === 'provider' && providerCategory !== undefined) {
            if (!MAIN_CATEGORIES.includes(providerCategory)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please select a valid provider category'
                });
            }
            user.providerCategory = providerCategory;
        }

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/**
 * Upgrade the CURRENT account to also be a provider — no second signup.
 * One account can be both a customer and a provider; this just flips the role
 * (auth loads the role fresh each request, so it takes effect immediately) and
 * seeds default availability so the calendar works right away.
 */
exports.becomeProvider = async (req, res) => {
    try {
        const { providerCategory } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.role === 'admin') {
            return res.status(400).json({ success: false, message: 'Admin accounts cannot become providers' });
        }
        if (!providerCategory || !providerCategory.trim()) {
            return res.status(400).json({ success: false, message: 'Please choose your main service category' });
        }

        user.role = 'provider';
        user.providerCategory = providerCategory.trim().slice(0, 100);
        await user.save();

        // Seed a default weekly schedule so the provider's calendar is usable immediately
        const Availability = require('../models/Availability');
        const exists = await Availability.findOne({ provider: user._id });
        if (!exists) {
            const open = { enabled: true, slots: [{ start: '09:00', end: '17:00' }] };
            const closed = { enabled: false, slots: [{ start: '09:00', end: '17:00' }] };
            await Availability.create({
                provider: user._id,
                schedule: { monday: open, tuesday: open, wednesday: open, thursday: open, friday: open, saturday: closed, sunday: closed },
            });
        }

        res.status(200).json({ success: true, message: 'Your business is set up — welcome aboard!', data: user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current and new password are required' });
        }
        const user = await User.findById(req.user.id).select('+password');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (!user.password) {
            return res.status(400).json({ success: false, message: 'This account uses Google sign-in — no password to change' });
        }
        const isMatch = await user.matchPassword(currentPassword);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/.test(newPassword);
        if (newPassword.length < 8 || !passwordRegex) {
            return res.status(400).json({ success: false, message: 'New password must be at least 8 characters and include an uppercase letter, a number and a special character' });
        }
        user.password = newPassword;
        // Invalidate all existing sessions (access + refresh tokens carry tokenVersion),
        // so changing the password signs out other devices — same as a reset.
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        await user.save();
        res.status(200).json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updatePortfolio = async (req, res) => {
    try {
        const { images, instagramUrl } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (!user.portfolio) user.portfolio = {};
        if (Array.isArray(images)) user.portfolio.images = images.slice(0, 30); // cap at 30 images
        if (instagramUrl !== undefined) user.portfolio.instagramUrl = instagramUrl.trim();

        user.markModified('portfolio');
        await user.save();
        res.status(200).json({ success: true, data: user.portfolio });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.completeProviderSetup = async (req, res) => {
    try {
        const { businessName, teamSize, locationType, address, currentSoftware, referralSource } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.role !== 'provider') return res.status(403).json({ success: false, message: 'Providers only' });

        if (!user.businessProfile) user.businessProfile = {};
        user.businessProfile.businessName = (businessName || '').trim();
        user.businessProfile.teamSize = teamSize || '';
        user.businessProfile.locationType = locationType || '';
        user.businessProfile.address = (address || '').trim();
        user.businessProfile.currentSoftware = (currentSoftware || '').trim();
        user.businessProfile.referralSource = referralSource || '';
        user.providerSetupComplete = true;

        user.markModified('businessProfile');
        await user.save();
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.verifyEmail = async (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.redirect(`${process.env.CLIENT_URL}/verify-email?status=invalid`);
        }

        const user = await User.findOne({
            verificationToken: token,
            verificationTokenExpiry: { $gt: new Date() },
        });

        if (!user) {
            return res.redirect(`${process.env.CLIENT_URL}/verify-email?status=expired`);
        }

        user.isVerified = true;
        user.verificationToken = null;
        user.verificationTokenExpiry = null;
        await user.save();

        // Send role-specific welcome email (fire-and-forget — must not block the redirect)
        sendWelcomeEmail(user.email, user.name, user.role).catch(() => {});

        return res.redirect(`${process.env.CLIENT_URL}/verify-email?status=success&role=${user.role}`);
    } catch (error) {
        return res.redirect(`${process.env.CLIENT_URL}/verify-email?status=error`);
    }
};

/**
 * POST /api/auth/forgot-password
 * Sends a password reset email. Always responds with 200 to prevent user enumeration.
 */
exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordResetToken +passwordResetExpiry');
        // Always return success so attackers cannot enumerate registered emails
        if (!user || user.provider !== 'local') {
            return res.status(200).json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
        }

        // Generate a secure random token
        const rawToken = crypto.randomBytes(32).toString('hex');
        // Store its SHA-256 hash in the DB (never the raw token)
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

        user.passwordResetToken = hashedToken;
        user.passwordResetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await user.save({ validateBeforeSave: false });

        const { sendPasswordResetEmail } = require('../utils/emailService');
        await sendPasswordResetEmail(user.email, user.name, rawToken);

        return res.status(200).json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * POST /api/auth/reset-password
 * Verifies the token and sets a new password.
 */
exports.resetPassword = async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).json({ success: false, message: 'Token and new password are required' });
        }

        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters and include an uppercase letter, a number and a special character'
            });
        }

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpiry: { $gt: new Date() },
        }).select('+passwordResetToken +passwordResetExpiry');

        if (!user) {
            return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired' });
        }

        user.password = password;
        user.passwordResetToken = null;
        user.passwordResetExpiry = null;
        // Invalidate all existing sessions
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        await user.save();

        return res.status(200).json({ success: true, message: 'Password reset successfully. You can now sign in.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};