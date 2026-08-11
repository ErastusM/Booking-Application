const crypto = require('crypto');
const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const Service = require('../models/Service');
const StaffAvailability = require('../models/StaffAvailability');
const { validate: validatePermissions } = require('../utils/permissions');

exports.getMyTeam = async (req, res) => {
    try {
        // `user` is populated with its permission flags so the Team screen can
        // show each member's calendar access without a request per member.
        // Callers that only test `member.user` for truthiness ("has a login")
        // are unaffected — a populated document is just as truthy as an id.
        const members = await TeamMember.find({ provider: req.user._id })
            .populate('user', 'staffPermissions')
            .sort({ createdAt: 1 });
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

/**
 * DELETE /api/team/:id — archive a team member.
 *
 * Deliberately NOT a delete. Appointments, earnings and reviews all reference
 * this _id, so removing the row stripped the staff member's name off every
 * booking they had ever done and broke per-staff history and reporting — the
 * business loses its own records the moment someone leaves.
 *
 * Archiving keeps all of that resolvable and still ends their working life
 * here: `isActive:false` is what stops new bookings reaching them (the roster
 * query in utils/staffBooking filters on it), and the login revocation below
 * is unchanged. Reversible via POST /:id/restore.
 */
exports.deleteTeamMember = async (req, res) => {
    try {
        const member = await TeamMember.findOneAndUpdate(
            { _id: req.params.id, provider: req.user._id },
            { $set: { isActive: false, archivedAt: new Date() } },
            { new: true },
        );
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        // Archiving someone must also end their access. Removing them from the
        // roster alone left the linked User{role:'staff'} account fully alive with
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
        res.status(200).json({ success: true, message: 'Team member archived', data: member });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * PUT /api/team/:id/permissions  (provider/admin)
 * Body: { permissions: ['calendar:all', …] }
 *
 * What a staff member is allowed to do, set by the owner. Only flags the API
 * actually enforces (or the descriptive ones the invite flow writes) are
 * accepted — an unknown flag is rejected rather than stored, so a typo can't
 * sit in the database looking like a granted permission.
 *
 * A staff member can never reach this: the router gates the whole file to
 * provider/admin, which is the difference between a permission and a
 * preference.
 */
exports.setTeamMemberPermissions = async (req, res) => {
    try {
        const { accepted, rejected } = validatePermissions(req.body.permissions);
        if (rejected.length) {
            return res.status(400).json({ success: false, message: `Unknown permission: ${rejected.join(', ')}` });
        }

        const member = await TeamMember.findOne({ _id: req.params.id, provider: req.user._id });
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
        if (!member.user) {
            return res.status(400).json({
                success: false,
                message: 'This team member has no login yet — invite them first.',
            });
        }

        const staffUser = await User.findOneAndUpdate(
            // Re-assert the link rather than trusting member.user alone: the
            // account must still be a staff account belonging to this business.
            { _id: member.user, role: 'staff', staffOf: req.user._id },
            { $set: { staffPermissions: accepted } },
            { new: true },
        ).select('staffPermissions');
        if (!staffUser) {
            return res.status(404).json({ success: false, message: 'That login no longer belongs to your team' });
        }

        res.status(200).json({ success: true, data: { permissions: staffUser.staffPermissions } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * POST /api/team/:id/restore  (provider/admin)
 *
 * Bring an archived member back onto the roster. Their bookings, earnings and
 * reviews were never detached, so nothing has to be rebuilt — this only puts
 * them back in front of new bookings.
 *
 * Their LOGIN is deliberately not restored: archiving revoked the tokens and
 * severed `staffOf`, and silently handing that access back would make "archive"
 * a weaker action than it looked. Re-inviting is the explicit way to do it.
 */
exports.restoreTeamMember = async (req, res) => {
    try {
        const member = await TeamMember.findOneAndUpdate(
            { _id: req.params.id, provider: req.user._id },
            { $set: { isActive: true, archivedAt: null } },
            { new: true },
        );
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
        res.status(200).json({ success: true, data: member });
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
