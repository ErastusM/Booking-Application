const User = require('../models/User');

exports.getAllUsers = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const skip = (page - 1) * limit;

        const filter = {};
        const { search, role, status } = req.query;

        if (role && ['customer', 'provider', 'admin'].includes(role)) {
            filter.role = role;
        }
        if (status === 'active') filter.isActive = true;
        if (status === 'suspended') filter.isActive = false;
        if (search && search.trim()) {
            const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp(safe, 'i');
            filter.$or = [{ name: rx }, { email: rx }];
        }

        const [users, total] = await Promise.all([
            User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit),
            User.countDocuments(filter),
        ]);
        res.status(200).json({ success: true, count: users.length, total, page, pages: Math.ceil(total / limit), data: users });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.toggleUserActive = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (user.role === 'admin') {
            return res.status(400).json({ success: false, message: 'Cannot suspend an admin account' });
        }
        user.isActive = !user.isActive;
        // Revoke active sessions so a suspended user is logged out immediately
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        await user.save();

        const safeUser = user.toObject();
        delete safeUser.password;
        res.status(200).json({
            success: true,
            message: user.isActive ? 'User reactivated' : 'User suspended',
            data: safeUser,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        await User.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;

        if (!['customer', 'provider', 'admin'].includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { role },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};