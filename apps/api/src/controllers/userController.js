const User = require('../models/User');
const { removeBusinessData, keepClientNameOnBookings } = require('../utils/adminAccountRemoval');

// The admin seeded from ADMIN_EMAIL at boot (server.js seedAdmin). Its admin
// access can never be removed from the console.
const isSuperAdmin = (u) => !!u && u.role === 'admin' && !!process.env.ADMIN_EMAIL
    && String(u.email || '').toLowerCase() === String(process.env.ADMIN_EMAIL).toLowerCase();

// A team member's login belongs to their business (role 'staff', or any account
// still attached to a business via staffOf).
const isTeamLogin = (u) => !!u && (u.role === 'staff' || !!u.staffOf);

const ROLE_FILTERS = ['customer', 'provider', 'staff', 'admin'];

exports.getAllUsers = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const skip = (page - 1) * limit;

        const filter = {};
        const { search, role, status } = req.query;

        if (role && ROLE_FILTERS.includes(role)) {
            filter.role = role;
        }
        if (status === 'active') filter.isActive = true;
        if (status === 'suspended') filter.isActive = false;
        if (search && search.trim()) {
            const safe = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp(safe, 'i');
            filter.$or = [{ name: rx }, { email: rx }, { 'businessProfile.businessName': rx }];
        }

        const [rows, total] = await Promise.all([
            // staffOf → the business a team login works for ("Staff · Vido Barber").
            User.find(filter).select('-password').populate('staffOf', 'name businessProfile.businessName')
                .sort({ createdAt: -1 }).skip(skip).limit(limit),
            User.countDocuments(filter),
        ]);
        // isSuperAdmin: the console hides "Remove admin" for the seeded admin.
        const users = rows.map((u) => ({ ...u.toJSON(), isSuperAdmin: isSuperAdmin(u) }));
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

/**
 * GET /api/users/:id/delete-preview (admin) — what Delete will do, in numbers,
 * for the confirmation dialog. Reads only.
 */
exports.getDeletePreview = async (req, res) => {
    try {
        if (!require('mongoose').isValidObjectId(req.params.id)) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const user = await User.findById(req.params.id).select('role staffOf name');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const Appointment = require('../models/Appointment');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const live = { status: { $in: ['pending', 'confirmed'] }, appointmentDate: { $gte: today } };
        if (user.role === 'provider') {
            const Service = require('../models/Service');
            const TeamMember = require('../models/TeamMember');
            const [services, teamMembers, staffLogins, upcomingBookings, bookings] = await Promise.all([
                Service.countDocuments({ provider: user._id, isActive: true }),
                TeamMember.countDocuments({ provider: user._id }),
                User.countDocuments({ staffOf: user._id, role: 'staff' }),
                Appointment.countDocuments({ provider: user._id, ...live }),
                Appointment.countDocuments({ provider: user._id }),
            ]);
            return res.status(200).json({ success: true, data: {
                role: user.role, services, teamMembers, staffLogins, upcomingBookings, pastBookings: bookings - upcomingBookings,
            } });
        }
        const bookings = await Appointment.countDocuments({ customer: user._id });
        return res.status(200).json({ success: true, data: { role: user.role, bookings } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * DELETE /api/users/:id (admin). Refuses your own account, any admin, and team
 * member logins (their business removes them). A business or a client is
 * cleaned up first — see utils/adminAccountRemoval — then the row is deleted.
 */
exports.deleteUser = async (req, res) => {
    try {
        if (!require('mongoose').isValidObjectId(req.params.id)) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (String(user._id) === String(req.user._id)) {
            return res.status(400).json({ success: false, code: 'delete_self', message: 'You can’t delete your own account from the admin console.' });
        }
        if (user.role === 'admin') {
            return res.status(403).json({ success: false, code: 'delete_admin', message: 'Admin accounts can’t be deleted. Remove their admin access first.' });
        }
        if (isTeamLogin(user)) {
            return res.status(400).json({ success: false, code: 'delete_team_login', message: 'This is a team member’s login. Their business removes it from Team.' });
        }

        let summary = {};
        if (user.role === 'provider') summary = await removeBusinessData(user._id, req.user._id);
        else summary = await keepClientNameOnBookings(user);

        await User.findByIdAndDelete(user._id);
        res.status(200).json({ success: true, message: 'User deleted successfully', data: summary });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// ── Favorites (saved providers) — available to any signed-in user ──
exports.getFavorites = async (req, res) => {
    try {
        const me = await User.findById(req.user.id).select('favorites');
        res.status(200).json({ success: true, data: me?.favorites || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.toggleFavorite = async (req, res) => {
    try {
        const { providerId } = req.params;
        const provider = await User.findOne({ _id: providerId, role: 'provider' }).select('_id');
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const me = await User.findById(req.user.id).select('favorites');
        if (!me) return res.status(404).json({ success: false, message: 'User not found' });

        const idx = me.favorites.findIndex(f => f.toString() === providerId);
        const liked = idx < 0; // not yet saved → this toggle adds (saves + likes)
        if (idx >= 0) me.favorites.splice(idx, 1);
        else me.favorites.push(provider._id);
        await me.save();

        // One heart = private save + public like. Keep the provider's public like count
        // in step with the toggle. On un-like, only decrement when the count is already
        // above 0 — favorites saved before this counter existed were never counted, so a
        // blind $inc:-1 could otherwise drift the stored value negative.
        if (liked) {
            await User.updateOne({ _id: provider._id }, { $inc: { 'businessProfile.likesCount': 1 } });
        } else {
            await User.updateOne(
                { _id: provider._id, 'businessProfile.likesCount': { $gt: 0 } },
                { $inc: { 'businessProfile.likesCount': -1 } }
            );
        }

        res.status(200).json({ success: true, data: me.favorites });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * PUT /api/users/:id/role (admin) — "Make admin" and "Remove admin".
 *
 * Make admin records the role the account had (roleBeforeAdmin) so Remove
 * admin can put it back. Team member logins can't be made admins (they belong
 * to a business). Remove admin is refused for your own account, for the seeded
 * admin (ADMIN_EMAIL) and for the last admin; it returns the account to its
 * recorded role, or — for an admin promoted before that was recorded — to
 * customer only (the console asks the admin to confirm that).
 */
exports.updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;

        if (!['customer', 'provider', 'admin'].includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }
        if (!require('mongoose').isValidObjectId(req.params.id)) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Changing the role can move the account to the other side of the
        // product (accountType is derived from role). Block the change when the
        // email already holds a separate account on the target side, and keep
        // accountType in sync explicitly — findByIdAndUpdate skips save hooks.
        const accountType = User.accountTypeForRole(role);
        const target = await User.findById(req.params.id).select('email role staffOf roleBeforeAdmin');
        if (!target) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (target.role === role) {
            return res.status(400).json({ success: false, message: `This account is already a ${role}.` });
        }
        if (String(target._id) === String(req.user._id)) {
            return res.status(400).json({ success: false, code: 'role_self', message: 'You can’t change your own admin access.' });
        }
        if (isTeamLogin(target)) {
            return res.status(400).json({ success: false, code: 'role_team_login', message: 'A team member’s login belongs to their business and can’t be given another role.' });
        }
        const update = { role, accountType };
        if (role === 'admin') {
            update.roleBeforeAdmin = target.role; // customer or provider — staff is refused above
        } else if (target.role === 'admin') {
            if (isSuperAdmin(target)) {
                return res.status(400).json({ success: false, code: 'role_super_admin', message: 'The main Bookplus admin account can’t lose admin access.' });
            }
            const admins = await User.countDocuments({ role: 'admin' });
            if (admins <= 1) {
                return res.status(400).json({ success: false, code: 'role_last_admin', message: 'This is the last admin. Make someone else an admin first.' });
            }
            const back = target.roleBeforeAdmin || 'customer';
            if (role !== back) {
                return res.status(400).json({
                    success: false, code: 'role_demote_mismatch',
                    message: target.roleBeforeAdmin
                        ? `This admin was a ${back} before, so Remove admin makes them a ${back} again.`
                        : 'There is no record of this admin’s earlier role, so Remove admin makes them a customer.',
                });
            }
            update.roleBeforeAdmin = null;
        }
        const conflict = await User.findOne({
            email: target.email,
            _id: { $ne: target._id },
            role: User.roleFilterForAccountType(accountType),
        });
        if (conflict) {
            return res.status(400).json({
                success: false,
                message: `This email already has a separate ${accountType} account — the role cannot be changed.`,
            });
        }

        // Signed-in sessions of the account are ended: its access has changed.
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { $set: update, $inc: { tokenVersion: 1 } },
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