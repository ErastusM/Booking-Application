const crypto = require('crypto');
const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const Service = require('../models/Service');
const StaffAvailability = require('../models/StaffAvailability');

exports.getMyTeam = async (req, res) => {
    try {
        const members = await TeamMember.find({ provider: req.user._id }).sort({ createdAt: 1 });
        res.status(200).json({ success: true, data: members });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.addTeamMember = async (req, res) => {
    try {
        const { name, role, email, phone, color } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }
        const member = await TeamMember.create({
            provider: req.user._id,
            name: name.trim(),
            role: (role || 'Staff').trim(),
            email: (email || '').trim().toLowerCase(),
            phone: (phone || '').trim(),
            color: color || '#f03e16',
        });
        res.status(201).json({ success: true, data: member });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateTeamMember = async (req, res) => {
    try {
        const { name, role, email, phone, color, isActive } = req.body;
        const member = await TeamMember.findOneAndUpdate(
            { _id: req.params.id, provider: req.user._id },
            { name, role, email, phone, color, isActive },
            { new: true, runValidators: true }
        );
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
        res.status(200).json({ success: true, data: member });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deleteTeamMember = async (req, res) => {
    try {
        const member = await TeamMember.findOneAndDelete({ _id: req.params.id, provider: req.user._id });
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        // Removing someone from the roster must also end their access. Deleting the
        // roster row alone left the linked User{role:'staff'} account fully alive with
        // valid access AND refresh tokens: a dismissed employee kept a working login
        // to the business app. Bumping tokenVersion invalidates every issued token at
        // the next request (middleware/auth checks it), clearing the jti list kills
        // refresh, and dropping staffOf severs the link to this business so nothing
        // can re-derive staff powers. The account itself is left intact rather than
        // deleted — it may hold message history, and destroying it is not what
        // "remove from team" asked for.
        if (member.user) {
            await User.updateOne(
                { _id: member.user },
                { $inc: { tokenVersion: 1 }, $set: { refreshTokenJtis: [], staffOf: null } },
            );
        }
        res.status(200).json({ success: true, message: 'Team member removed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * POST /api/team/:id/invite  (provider/admin)
 * Creates (or links) a User{role:'staff', staffOf: owner} for this roster
 * member and emails a set-password invite. Body: { email?, permissions? } —
 * email falls back to the roster member's stored email.
 */
exports.inviteTeamMember = async (req, res) => {
    try {
        const member = await TeamMember.findOne({ _id: req.params.id, provider: req.user._id });
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
        if (member.user) return res.status(400).json({ success: false, message: 'This team member already has a login' });

        const email = ((req.body.email || member.email) || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ success: false, message: 'An email address is required to invite' });

        let staffUser = await User.findOne({ email });
        if (staffUser) {
            const isOwnStaff = staffUser.role === 'staff'
                && staffUser.staffOf && staffUser.staffOf.toString() === req.user._id.toString();
            if (!isOwnStaff) {
                return res.status(409).json({ success: false, message: 'That email already belongs to another account' });
            }
        } else {
            staffUser = new User({
                name: member.name,
                email,
                // Staff can update their own phone after first login.
                phone: member.phone || req.user.phone,
                role: 'staff',
                staffOf: req.user._id,
                staffPermissions: Array.isArray(req.body.permissions) && req.body.permissions.length
                    ? req.body.permissions
                    : ['calendar:self', 'clients:assigned'],
                provider: 'local',
                isVerified: true, // owner-vouched; they prove the mailbox by using the invite link
            });
        }

        // Set-password token — same mechanics as the reset flow, 7-day window.
        const rawToken = crypto.randomBytes(32).toString('hex');
        staffUser.passwordResetToken = crypto.createHash('sha256').update(rawToken).digest('hex');
        staffUser.passwordResetExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await staffUser.save({ validateBeforeSave: false });

        member.user = staffUser._id;
        if (!member.email) member.email = email;
        await member.save();

        // Fire-and-forget (matches every other email in the app).
        const { sendStaffInviteEmail } = require('../utils/emailService');
        const businessName = req.user.businessProfile?.businessName || req.user.name;
        Promise.resolve(sendStaffInviteEmail(email, member.name, businessName, rawToken)).catch(() => {});

        res.status(200).json({ success: true, data: { member, staffUserId: staffUser._id } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * PUT /api/team/:id/services  (provider/admin)
 * Body: { services: [serviceId] } — [] means "performs all business services".
 * Every id must be one of the owner's own services.
 */
exports.setTeamMemberServices = async (req, res) => {
    try {
        const { services } = req.body;
        if (!Array.isArray(services)) {
            return res.status(400).json({ success: false, message: 'services must be an array of service ids' });
        }
        const member = await TeamMember.findOne({ _id: req.params.id, provider: req.user._id });
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        if (services.length) {
            const owned = await Service.countDocuments({ _id: { $in: services }, provider: req.user._id });
            if (owned !== new Set(services.map(String)).size) {
                return res.status(400).json({ success: false, message: 'All services must belong to your business' });
            }
        }

        member.services = services;
        await member.save();
        res.status(200).json({ success: true, data: member });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Owner/admin, or the staff member themself (their User is linked to the roster row
// and belongs to this business).
const canTouchStaffAvailability = (reqUser, member) =>
    reqUser.role === 'admin'
    || member.provider.toString() === reqUser._id.toString()
    || (reqUser.role === 'staff'
        && member.user && member.user.toString() === reqUser._id.toString()
        && reqUser.staffOf && reqUser.staffOf.toString() === member.provider.toString());

/**
 * GET /api/team/:id/availability  (provider/admin, or staff-self)
 * data: null means "no per-staff schedule — inherits business hours".
 */
exports.getTeamMemberAvailability = async (req, res) => {
    try {
        const member = await TeamMember.findById(req.params.id);
        if (!member || !canTouchStaffAvailability(req.user, member)) {
            return res.status(404).json({ success: false, message: 'Team member not found' });
        }
        const availability = await StaffAvailability.findOne({ teamMember: member._id });
        res.status(200).json({ success: true, data: availability });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * PUT /api/team/:id/availability  (provider/admin, or staff-self)
 * Body: { schedule } — upserts the per-staff schedule.
 */
exports.updateTeamMemberAvailability = async (req, res) => {
    try {
        const { schedule } = req.body;
        if (!schedule || typeof schedule !== 'object') {
            return res.status(400).json({ success: false, message: 'schedule is required' });
        }
        const member = await TeamMember.findById(req.params.id);
        if (!member || !canTouchStaffAvailability(req.user, member)) {
            return res.status(404).json({ success: false, message: 'Team member not found' });
        }
        const availability = await StaffAvailability.findOneAndUpdate(
            { teamMember: member._id },
            { provider: member.provider, teamMember: member._id, schedule },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
        res.status(200).json({ success: true, data: availability });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
