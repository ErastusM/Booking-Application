const User = require('../models/User');
const { generateToken, generateRefreshToken } = require('../utils/helpers');

/**
 * =========================
 * REGISTER (LOCAL ONLY)
 * =========================
 */
exports.register = async (req, res) => {
    try {
        const { name, email, password, phone, role } = req.body;

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
                message: 'User already exists with that email'
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

        const user = await User.create({
            name,
            email,
            password,
            phone,
            role: assignedRole,
            provider: 'local'
        });

        const token = generateToken(user._id);
        const refreshToken = generateRefreshToken(user._id);

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                },
                token,
                refreshToken
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * =========================
 * LOGIN (LOCAL ONLY)
 * =========================
 */
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

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

        const token = generateToken(user._id);
        const refreshToken = generateRefreshToken(user._id);

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                },
                token,
                refreshToken
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * =========================
 * GOOGLE CALLBACK (NOT USED DIRECTLY HERE)
 * =========================
 * Passport handles this.
 * This exists ONLY for clarity.
 */
exports.googleCallback = (req, res) => {
    try {
        const user = req.user;

        const token = generateToken(user._id);
        const refreshToken = generateRefreshToken(user._id);

        return res.redirect(
            `${process.env.CLIENT_URL}/auth/callback` +
            `?token=${token}` +
            `&refreshToken=${refreshToken}` +
            `&role=${user.role}` +
            `&name=${encodeURIComponent(user.name)}`
        );
    } catch (error) {
        return res.redirect(
            `${process.env.CLIENT_URL}/login?error=google_failed`
        );
    }
};

/**
 * =========================
 * LOGOUT
 * =========================
 */
exports.logout = (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Logged out successfully'
    });
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
            message: error.message
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
        const { name, phone, avatar } = req.body;

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

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};