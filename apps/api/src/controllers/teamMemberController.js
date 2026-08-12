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
        const {
            name, role, email, phone, color, isActive, bookable,
            photoUrl, country, address, emergencyContact,
        } = req.body;
        const member = await TeamMember.findOneAndUpdate(
            { _id: req.params.id, provider: req.user._id },
            // Undefined keys are dropped by Mongoose, so a partial body only
            // touches the fields it actually sends.
            { name, role, email, phone, color, isActive, bookable, photoUrl, country, address, emergencyContact },
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
 * GET  /api/team/:id/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD  (provider/admin)
 * PUT  /api/team/:id/shifts   body: { date, slots: [{start,end}], breaks: [{start,end,label}], note }
 * DELETE /api/team/:id/shifts/:date
 *
 * Date-specific working days. See models/Shift for the precedence contract —
 * in short, a shift REPLACES the weekly pattern for that one date, and
 * deleting it hands the date back to the pattern.
 *
 * A shift with no slots is meaningful, not empty: it is a rostered day off,
 * and it is the only way to say "not in this Thursday" without editing every
 * Thursday.
 */
const Shift = require('../models/Shift');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const toMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

/** Validate and normalise the periods on a shift, or explain the refusal. */
const cleanPeriods = (list, label) => {
    if (list === undefined) return { periods: [] };
    if (!Array.isArray(list)) return { error: `${label} must be an array` };
    const periods = [];
    for (const p of list) {
        if (!p || !HHMM.test(p.start || '') || !HHMM.test(p.end || '')) {
            return { error: `Every ${label} entry needs a start and end as HH:MM` };
        }
        if (toMinutes(p.end) <= toMinutes(p.start)) {
            return { error: `A ${label} must end after it starts` };
        }
        periods.push(p);
    }
    // Overlapping working periods would double-count the day and make
    // occupancy nonsense, so they are refused rather than silently merged.
    const sorted = [...periods].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < sorted.length; i += 1) {
        if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) {
            return { error: `Two ${label} entries overlap` };
        }
    }
    return { periods: sorted };
};

exports.getTeamMemberShifts = async (req, res) => {
    try {
        const member = await TeamMember.findOne({ _id: req.params.id, provider: req.user._id });
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        const { from, to } = req.query;
        const q = { teamMember: member._id };
        if (DATE_KEY.test(from || '') && DATE_KEY.test(to || '')) q.date = { $gte: from, $lte: to };

        const shifts = await Shift.find(q).sort({ date: 1 }).lean();
        res.status(200).json({ success: true, data: shifts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.setTeamMemberShift = async (req, res) => {
    try {
        const { date, note } = req.body;
        if (!DATE_KEY.test(date || '')) {
            return res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD' });
        }

        const slots = cleanPeriods(req.body.slots, 'working period');
        if (slots.error) return res.status(400).json({ success: false, message: slots.error });
        const breaks = cleanPeriods(req.body.breaks, 'break');
        if (breaks.error) return res.status(400).json({ success: false, message: breaks.error });

        // A break outside every working period is almost always a mistake — and
        // silently keeping it would make the shift claim hours it doesn't have.
        const outside = breaks.periods.find((b) => !slots.periods.some(
            (sl) => toMinutes(b.start) >= toMinutes(sl.start) && toMinutes(b.end) <= toMinutes(sl.end),
        ));
        if (outside) {
            return res.status(400).json({
                success: false,
                message: `The ${outside.start}–${outside.end} break falls outside the working hours for that day.`,
            });
        }

        const member = await TeamMember.findOne({ _id: req.params.id, provider: req.user._id });
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        const shift = await Shift.findOneAndUpdate(
            { teamMember: member._id, date },
            { $set: { provider: req.user._id, slots: slots.periods, breaks: breaks.periods, note: note || '' } },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        );
        res.status(200).json({ success: true, data: shift });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.clearTeamMemberShift = async (req, res) => {
    try {
        const member = await TeamMember.findOne({ _id: req.params.id, provider: req.user._id });
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        // Removing the row is the point: the date falls back to the weekly
        // pattern, which is different from storing a shift with no slots (a
        // rostered day off).
        await Shift.deleteOne({ teamMember: member._id, date: req.params.date });
        res.status(200).json({ success: true, message: 'Back to their usual hours for that day' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * GET /api/team/:id/stats?days=30  (provider/admin)
 *
 * The Overview tab: how this member's last N days actually went, computed from
 * bookings rather than entered by hand.
 *
 * Two definitions are worth stating plainly, because "occupancy" and
 * "retention" mean different things at different businesses and a number
 * nobody can define is worse than no number:
 *
 *   occupancy = minutes booked ÷ minutes scheduled, over the window. Scheduled
 *               comes from the member's own weekly hours, falling back to the
 *               business hours when they have none of their own. It is NOT
 *               shift-aware yet — there are no date-specific shifts in the
 *               model — so a day off taken as time-off still counts as
 *               scheduled and drags the figure down. Reported as null rather
 *               than a wrong number when nothing is scheduled at all.
 *
 *   retention = clients who booked this member more than once ÷ clients who
 *               booked them at all, within the window. Guests are excluded:
 *               they have no account, so two guest bookings cannot be known to
 *               be the same person.
 */
exports.getTeamMemberStats = async (req, res) => {
    try {
        const member = await TeamMember.findOne({ _id: req.params.id, provider: req.user._id });
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        const days = Math.min(365, Math.max(1, parseInt(req.body?.days || req.query.days, 10) || 30));
        const to = new Date(); to.setHours(23, 59, 59, 999);
        const from = new Date(to); from.setDate(from.getDate() - (days - 1)); from.setHours(0, 0, 0, 0);

        const Appointment = require('../models/Appointment');
        const Review = require('../models/Review');
        const Availability = require('../models/Availability');

        const inWindow = {
            provider: req.user._id,
            teamMember: member._id,
            appointmentDate: { $gte: from, $lte: to },
        };

        const [done, upcoming, ratingAgg, staffHours, businessHours] = await Promise.all([
            Appointment.find({ ...inWindow, status: 'completed' })
                .select('totalPrice customer startTime endTime'),
            Appointment.countDocuments({
                provider: req.user._id,
                teamMember: member._id,
                status: { $in: ['pending', 'confirmed'] },
                appointmentDate: { $gte: new Date() },
            }),
            // Reviews carry no teamMember, so the link runs through the booking.
            Review.aggregate([
                { $lookup: { from: 'appointments', localField: 'appointment', foreignField: '_id', as: 'appt' } },
                { $unwind: '$appt' },
                { $match: { 'appt.teamMember': member._id } },
                { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
            ]),
            StaffAvailability.findOne({ teamMember: member._id }),
            Availability.findOne({ provider: req.user._id }),
        ]);

        const revenue = done.reduce((sum, a) => sum + (a.totalPrice || 0), 0);

        // Clients: registered accounts only, so "the same person twice" is knowable.
        const counts = new Map();
        done.forEach((a) => {
            if (!a.customer) return;
            const k = a.customer.toString();
            counts.set(k, (counts.get(k) || 0) + 1);
        });
        const clients = counts.size;
        const returning = [...counts.values()].filter((n) => n > 1).length;

        // Occupancy.
        const toMin = (t) => {
            const [h = 0, m = 0] = String(t || '').split(':').map(Number);
            return (h || 0) * 60 + (m || 0);
        };
        const bookedMinutes = done.reduce((sum, a) => {
            const mins = toMin(a.endTime) - toMin(a.startTime);
            return sum + (mins > 0 ? mins : 0);
        }, 0);

        const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const schedule = staffHours?.schedule || businessHours?.schedule || null;
        let scheduledMinutes = 0;
        if (schedule) {
            for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                const cfg = schedule[DAY_NAMES[d.getDay()]];
                if (!cfg?.enabled || !Array.isArray(cfg.slots)) continue;
                cfg.slots.forEach((s) => {
                    const mins = toMin(s.end) - toMin(s.start);
                    if (mins > 0) scheduledMinutes += mins;
                });
            }
        }

        res.status(200).json({
            success: true,
            data: {
                windowDays: days,
                appointments: done.length,
                revenue,
                clients,
                upcoming,
                rating: ratingAgg[0] ? Math.round(ratingAgg[0].avg * 10) / 10 : null,
                reviews: ratingAgg[0]?.count || 0,
                // null, not 0 — "we cannot say" is different from "they were idle".
                occupancy: scheduledMinutes > 0
                    ? Math.min(100, Math.round((bookedMinutes / scheduledMinutes) * 100))
                    : null,
                retention: clients > 0 ? Math.round((returning / clients) * 100) : null,
                bookedMinutes,
                scheduledMinutes,
            },
        });
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
