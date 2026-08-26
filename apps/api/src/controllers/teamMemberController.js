const crypto = require('crypto');
const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const Service = require('../models/Service');
const StaffAvailability = require('../models/StaffAvailability');
const Appointment = require('../models/Appointment');
const { validate: validatePermissions } = require('../utils/permissions');
const { memberBusyIntervals, memberInvolvedFilter } = require('../utils/staffBooking');

const dayKeyOf = (d) => new Date(d).toISOString().slice(0, 10);
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

// The owner's own work is stored UNASSIGNED (teamMember null) — there is no
// roster row for the boss. These mirror memberInvolvedFilter/memberBusyIntervals
// for that null case so the owner can be a handover target like anyone else.
const ownerInvolvedFilter = { $or: [{ teamMember: null }, { services: { $elemMatch: { teamMember: null } } }] };
const ownerBusyIntervals = (appt) => {
    if (Array.isArray(appt.services) && appt.services.length) {
        return appt.services.filter((s) => !s.teamMember).map((s) => [toMin(s.startTime), toMin(s.endTime)]);
    }
    return !appt.teamMember ? [[toMin(appt.startTime), toMin(appt.endTime)]] : [];
};

/**
 * POST /api/team/:id/handover  (provider/admin)  Body: { to: memberId }
 *
 * Move every UPCOMING booking (pending/confirmed, today onward) from one
 * roster member to another — the "clients booked the wrong person" and
 * "member is leaving, hand over their book" operation. Multi-service tickets
 * move only the segments the source member performs; the top-level performer
 * follows the first segment, matching how bookings are created.
 *
 * Each booking is checked against the TARGET's calendar (their existing
 * bookings plus the ones moved so far) and skipped on a clash rather than
 * double-booking them — skips come back in the response so the owner can
 * resolve those by hand. Hours/blocked-time are deliberately NOT checked:
 * this is an owner action, and owners can already place work outside hours
 * (the walk-in override precedent).
 */
exports.handoverUpcomingBookings = async (req, res) => {
    try {
        const from = await TeamMember.findOne({ _id: req.params.id, provider: req.user._id });
        if (!from) return res.status(404).json({ success: false, message: 'Team member not found' });
        // 'owner' hands the book to the boss — their work is stored unassigned
        // (teamMember null), so there is no roster row to look up.
        const toOwner = req.body.to === 'owner';
        let to = null;
        if (!toOwner) {
            to = await TeamMember.findOne({ _id: req.body.to, provider: req.user._id, isActive: true });
            if (!to) return res.status(400).json({ success: false, message: 'Choose an active team member to hand the bookings to' });
            if (String(from._id) === String(to._id)) {
                return res.status(400).json({ success: false, message: 'Pick a different member to hand over to' });
            }
        }
        const targetId = toOwner ? null : to._id;
        const targetInvolved = toOwner ? ownerInvolvedFilter : memberInvolvedFilter(to._id);
        const targetBusy = (a) => (toOwner ? ownerBusyIntervals(a) : memberBusyIntervals(a, to._id));

        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const scope = { provider: req.user._id, status: { $in: ['pending', 'confirmed'] }, appointmentDate: { $gte: dayStart } };
        const [sources, targetsExisting] = await Promise.all([
            Appointment.find({ ...scope, ...memberInvolvedFilter(from._id) }).sort({ appointmentDate: 1, startTime: 1 }),
            Appointment.find({ ...scope, ...targetInvolved }).select('appointmentDate startTime endTime teamMember services').lean(),
        ]);

        // The target's busy windows per day, extended as bookings move across.
        const busyByDay = {};
        targetsExisting.forEach((a) => {
            const k = dayKeyOf(a.appointmentDate);
            (busyByDay[k] = busyByDay[k] || []).push(...targetBusy(a));
        });

        const moved = [];
        const skipped = [];
        for (const appt of sources) {
            const k = dayKeyOf(appt.appointmentDate);
            const wanted = memberBusyIntervals(appt, from._id);
            const clash = wanted.some(([s, e]) => (busyByDay[k] || []).some(([bs, be]) => s < be && e > bs));
            if (clash) {
                skipped.push({ id: appt._id, date: k, startTime: appt.startTime, reason: 'conflict' });
                continue;
            }
            if (Array.isArray(appt.services) && appt.services.length) {
                appt.services.forEach((seg) => {
                    if (String(seg.teamMember) === String(from._id)) seg.teamMember = targetId;
                });
                // Top-level performer follows the first segment (matching how
                // bookings are created); null when that segment is now the owner's.
                appt.teamMember = appt.services[0].teamMember || null;
            } else {
                appt.teamMember = targetId;
            }
            await appt.save();
            (busyByDay[k] = busyByDay[k] || []).push(...wanted);
            moved.push(appt._id);
        }

        res.status(200).json({ success: true, data: { moved: moved.length, skipped, total: sources.length } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getMyTeam = async (req, res) => {
    try {
        // `user` is populated with its permission flags so the Team screen can
        // show each member's calendar access without a request per member.
        // Callers that only test `member.user` for truthiness ("has a login")
        // are unaffected — a populated document is just as truthy as an id.
        const members = await TeamMember.find({ provider: req.user._id })
            .populate('user', 'staffPermissions lastLoginAt')
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
        // Read the prior state so a change to `isActive` can be mirrored onto the
        // linked login below (findOneAndUpdate only returns the new value).
        const existing = await TeamMember.findOne({ _id: req.params.id, provider: req.user._id });
        if (!existing) return res.status(404).json({ success: false, message: 'Team member not found' });

        const member = await TeamMember.findOneAndUpdate(
            { _id: req.params.id, provider: req.user._id },
            // Undefined keys are dropped by Mongoose, so a partial body only
            // touches the fields it actually sends.
            { name, role, email, phone, color, isActive, bookable, photoUrl, country, address, emergencyContact },
            { new: true, runValidators: true }
        );
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        // Deactivating a member must also stop their login — not just new bookings.
        // Otherwise a "paused" staffer keeps a fully working session (access +
        // rotating refresh) to the business app. This is a REVERSIBLE suspension,
        // distinct from archive: staffOf is kept, so flipping isActive back on
        // restores access with no re-invite. Blocking the login without a
        // deactivatedAt makes the auth path treat it as suspended (it won't
        // auto-reactivate on next sign-in, the way a self-deactivation would).
        if (typeof isActive === 'boolean' && member.user && isActive !== existing.isActive) {
            if (isActive === false) {
                await User.updateOne(
                    { _id: member.user },
                    { $inc: { tokenVersion: 1 }, $set: { refreshTokenJtis: [], isActive: false, deactivatedAt: null } },
                );
            } else {
                await User.updateOne({ _id: member.user }, { $set: { isActive: true } });
            }
        }
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
        // Only revoke the login if NO other still-active roster row for this
        // business points at the same account. Two rows can share one User (a
        // duplicate re-add), and revoking here would lock the staffer out even
        // though the sibling row is still live and bookable. The new invite guard
        // prevents fresh duplicates; this protects any that already exist.
        const otherActive = member.user
            ? await TeamMember.findOne({ provider: member.provider, user: member.user, _id: { $ne: member._id }, isActive: true })
            : null;
        if (member.user && !otherActive) {
            await User.updateOne(
                { _id: member.user },
                { $inc: { tokenVersion: 1 }, $set: { refreshTokenJtis: [], staffOf: null } },
            );
            // `member.user` is deliberately KEPT: severing staffOf is what
            // actually ends their access (bumping tokenVersion only kills issued
            // tokens — they could otherwise just sign in again), and the link is
            // the only record of which account was theirs, which re-inviting
            // needs. See inviteTeamMember for the recovery path.
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
// The regex alone accepts impossible days — 2026-02-31, 2026-13-01. Round-trip
// through a UTC Date so a shift can only ever be stored against a real calendar
// date; a bogus key would otherwise sit in the collection matching nothing the
// booking path ever asks about.
const isRealDateKey = (s) => {
    if (!DATE_KEY.test(s || '')) return false;
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
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
        if (isRealDateKey(from) && isRealDateKey(to)) q.date = { $gte: from, $lte: to };

        const shifts = await Shift.find(q).sort({ date: 1 }).lean();
        res.status(200).json({ success: true, data: shifts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.setTeamMemberShift = async (req, res) => {
    try {
        const { date, note } = req.body;
        if (!isRealDateKey(date)) {
            return res.status(400).json({ success: false, message: 'date must be a real calendar date as YYYY-MM-DD' });
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
            // runValidators, or the schema is enforced on create() and nowhere on
            // the upsert path this endpoint actually uses — an over-long note or a
            // period missing start/end would be written unchecked.
            { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
        );
        res.status(200).json({ success: true, data: shift });
    } catch (error) {
        // runValidators surfaces a bad shift (e.g. an over-long note) as a
        // ValidationError — that is the caller's mistake, not a server fault, so
        // answer 400 rather than a misleading 500.
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: error.message });
        }
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
 *               is shift-aware: a date-specific Shift replaces the pattern for
 *               its day (slots minus breaks; an empty shift is a rostered day
 *               off worth zero), and days without a shift fall back to the
 *               member's own weekly hours, then to the business hours. Reported
 *               as null rather than a wrong number when nothing is scheduled at
 *               all — "we cannot say" is not the same as "they were idle".
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

        const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));

        // Anchor the window to the business day in Africa/Windhoek, then express
        // its boundaries at UTC-midnight — the exact instant appointmentDate is
        // stored at. Computed in raw UTC (to.setHours) the window rolled over on
        // the server's clock, so for the two hours after local midnight "today"
        // hadn't started yet and that day's bookings fell outside the window.
        const { NAMIBIA_OFFSET_MIN } = require('../utils/appointmentTime');
        const nowNam = new Date(Date.now() + NAMIBIA_OFFSET_MIN * 60 * 1000);
        const startOfToday = new Date(Date.UTC(nowNam.getUTCFullYear(), nowNam.getUTCMonth(), nowNam.getUTCDate()));
        const to = new Date(startOfToday); to.setUTCHours(23, 59, 59, 999);
        const from = new Date(startOfToday); from.setUTCDate(from.getUTCDate() - (days - 1));

        const Appointment = require('../models/Appointment');
        const Review = require('../models/Review');
        const Availability = require('../models/Availability');

        // A member counts for a booking if they are its top-level member OR they
        // perform one of its services. A multi-service booking is split across
        // several staff (services[].teamMember), and each must see — and be paid
        // for — only their own part, never the whole ticket.
        const memberMatch = { $or: [{ teamMember: member._id }, { 'services.teamMember': member._id }] };
        const inWindow = {
            provider: req.user._id,
            appointmentDate: { $gte: from, $lte: to },
            ...memberMatch,
        };

        const [done, upcoming, ratingAgg, staffHours, businessHours, shifts] = await Promise.all([
            Appointment.find({ ...inWindow, status: 'completed' })
                .select('totalPrice customer startTime endTime services'),
            // From the START OF TODAY, not from this instant. appointmentDate is
            // a date-only value stored at midnight, so comparing it against `now`
            // silently dropped every remaining booking today — at 09:00 a 15:00
            // appointment counted as already past. `startOfToday` is the Windhoek
            // day at UTC-midnight, matching how appointmentDate is stored. Within-
            // day precision would need startTime; the auto-complete job flips
            // finished bookings out of pending/confirmed, so this converges anyway.
            Appointment.countDocuments({
                provider: req.user._id,
                status: { $in: ['pending', 'confirmed'] },
                appointmentDate: { $gte: startOfToday },
                ...memberMatch,
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
            // Date-specific shifts across the window. A shift REPLACES the weekly
            // pattern for its date (models/Shift), so occupancy has to honour it —
            // otherwise a rostered day off still counts as scheduled and drags the
            // figure down, and an extra covered day is never counted at all.
            Shift.find({
                teamMember: member._id,
                date: { $gte: from.toISOString().slice(0, 10), $lte: to.toISOString().slice(0, 10) },
            }).select('date slots breaks').lean(),
        ]);

        const toMin = (t) => {
            const [h = 0, m = 0] = String(t || '').split(':').map(Number);
            return (h || 0) * 60 + (m || 0);
        };
        // This member's slice of a booking: the services assigned to them, or —
        // for a single-service booking with no per-service breakdown — the whole
        // thing. Crediting the top-level member with the full multi-service total
        // and its full span is exactly the misattribution this fixes: it inflated
        // the primary's revenue and occupancy and paid the other performers zero.
        const mySegments = (a) => (Array.isArray(a.services) && a.services.length
            ? a.services.filter((s) => String(s.teamMember) === String(member._id))
            : [{ price: a.totalPrice || 0, startTime: a.startTime, endTime: a.endTime }]);

        const revenue = done.reduce((sum, a) =>
            sum + mySegments(a).reduce((s, seg) => s + (seg.price || 0), 0), 0);
        const bookedMinutes = done.reduce((sum, a) =>
            sum + mySegments(a).reduce((s, seg) => {
                const mins = toMin(seg.endTime) - toMin(seg.startTime);
                return s + (mins > 0 ? mins : 0);
            }, 0), 0);

        // Clients: registered accounts only, so "the same person twice" is knowable.
        const counts = new Map();
        done.forEach((a) => {
            if (!a.customer) return;
            const k = a.customer.toString();
            counts.set(k, (counts.get(k) || 0) + 1);
        });
        const clients = counts.size;
        const returning = [...counts.values()].filter((n) => n > 1).length;

        // Occupancy. bookedMinutes is the member's own service minutes (computed
        // above, per-segment), so a shared multi-service booking no longer counts
        // its whole span against every performer.
        const sumPeriods = (list) => (list || []).reduce((acc, s) => {
            const mins = toMin(s.end) - toMin(s.start);
            return acc + (mins > 0 ? mins : 0);
        }, 0);

        const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const schedule = staffHours?.schedule || businessHours?.schedule || null;
        const shiftByDate = new Map((shifts || []).map((s) => [s.date, s]));
        // Iterate in UTC because appointmentDate — and therefore the shift keys and
        // the day-of-week the weekly pattern is indexed by — are all UTC-midnight.
        let scheduledMinutes = 0;
        for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
            const shift = shiftByDate.get(d.toISOString().slice(0, 10));
            if (shift) {
                // A shift is authoritative for its date: slots minus breaks. Empty
                // slots is a rostered day off — zero scheduled, correctly.
                scheduledMinutes += Math.max(0, sumPeriods(shift.slots) - sumPeriods(shift.breaks));
                continue;
            }
            const cfg = schedule?.[DAY_NAMES[d.getUTCDay()]];
            if (cfg?.enabled && Array.isArray(cfg.slots)) scheduledMinutes += sumPeriods(cfg.slots);
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

        // Archiving severs staffOf but keeps member.user, so a previously
        // archived member arrives here with a link that points at an account no
        // longer attached to this business. That is the documented recovery
        // path — re-inviting re-establishes it — so only refuse when the login
        // is still LIVE for us.
        const linked = member.user ? await User.findById(member.user) : null;
        const linkIntact = linked && linked.role === 'staff'
            && linked.staffOf && linked.staffOf.toString() === req.user._id.toString();
        // Only an account that has actually SIGNED IN is "already set up" and off-limits.
        // A member invited but never logged in falls through to a resend below: it lands
        // on the same account, mints a fresh token and re-sends — the recovery path when
        // the first email never arrived (wrong address, SMTP hiccup).
        if (linkIntact && linked.lastLoginAt) {
            return res.status(400).json({ success: false, message: 'This team member already has a login' });
        }

        const email = ((req.body.email || member.email) || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ success: false, message: 'An email address is required to invite' });

        // Scope to the BUSINESS side. An email may hold one customer account AND
        // one business account (the {email, accountType} unique index is built for
        // exactly that), so a bare `findOne({ email })` would return the person's
        // marketplace customer profile and wrongly 409 — blocking staff who are
        // also platform customers, a very common case. The staff login we create or
        // re-attach is always a business-side account.
        let staffUser = await User.findOne({ email, role: { $in: ['provider', 'staff', 'admin'] } });
        if (staffUser) {
            const isOwnStaff = staffUser.role === 'staff'
                && staffUser.staffOf && staffUser.staffOf.toString() === req.user._id.toString();
            // The account this member was previously linked to. It looks like a
            // stranger's now — staffOf is null — but we know it was ours because
            // the roster row still points at it.
            const isOurFormerStaff = linked && staffUser._id.equals(linked._id) && staffUser.role === 'staff';
            if (!isOwnStaff && !isOurFormerStaff) {
                return res.status(409).json({ success: false, message: 'That email already belongs to another account' });
            }
            if (isOurFormerStaff) staffUser.staffOf = req.user._id;   // re-attach
        } else {
            staffUser = new User({
                name: member.name,
                email,
                // Staff can update their own phone after first login.
                phone: member.phone || req.user.phone,
                role: 'staff',
                // Explicit because we save with validateBeforeSave:false below, which
                // skips the pre-validate hook that normally derives accountType from
                // role. Without it the staff account defaults to 'customer' and
                // collides on the {email, accountType} unique index with a same-email
                // marketplace customer — the business side is a distinct account.
                accountType: 'business',
                staffOf: req.user._id,
                staffPermissions: Array.isArray(req.body.permissions) && req.body.permissions.length
                    ? req.body.permissions
                    : ['calendar:self', 'clients:assigned'],
                provider: 'local',
                isVerified: true, // owner-vouched; they prove the mailbox by using the invite link
            });
        }

        // One login must not back two roster rows for the same business. If it did,
        // staff self-service (myMemberDoc / timeOff /mine) would resolve an arbitrary
        // row, and archiving either row would revoke the shared login while the other
        // stayed active. Refuse before linking; the current row is excluded so a
        // resend to this same member still works.
        const dupRow = await TeamMember.findOne({
            provider: req.user._id, user: staffUser._id, _id: { $ne: member._id }, isActive: true,
        });
        if (dupRow) {
            return res.status(400).json({ success: false, message: 'That login is already assigned to another team member.' });
        }

        // An invite always grants (or restores) access — a member deactivated or
        // archived earlier may have had their login blocked, and re-inviting is the
        // explicit way to let them back in.
        staffUser.isActive = true;

        // Set-password token — same mechanics as the reset flow, 7-day window.
        const rawToken = crypto.randomBytes(32).toString('hex');
        staffUser.passwordResetToken = crypto.createHash('sha256').update(rawToken).digest('hex');
        staffUser.passwordResetExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await staffUser.save({ validateBeforeSave: false });

        member.user = staffUser._id;
        if (!member.email) member.email = email;
        await member.save();

        // Awaited (not fire-and-forget) so the owner is told the truth about whether
        // the invite reached the person. The account and token are already saved above,
        // so a failed/again send never loses the login — the owner can just resend.
        // safeSend returns {skipped} when SMTP is off and {error} when a send throws;
        // anything else is a real delivery.
        const { sendStaffInviteEmail } = require('../utils/emailService');
        const businessName = req.user.businessProfile?.businessName || req.user.name;
        let emailSent = false;
        try {
            const result = await sendStaffInviteEmail(email, member.name, businessName, rawToken);
            emailSent = !!result && !result.skipped && !result.error;
        } catch { emailSent = false; }

        res.status(200).json({ success: true, data: { member, staffUserId: staffUser._id, email, emailSent } });
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

// The roster row for the logged-in staff principal, resolved from the token —
// same shape as timeOffController's /mine helper, so the staff self-service
// endpoints never take a member id in the URL (one they don't know and mustn't
// be able to spoof).
const myMemberDoc = (req) => (req.user.staffOf
    ? TeamMember.findOne({ user: req.user._id, provider: req.user.staffOf })
    : Promise.resolve(null));

/**
 * GET /api/team/mine/services  (staff-self)
 * data: { selected: [serviceId], services: [{ _id, name }] } — the member's own
 * assignment plus the business's full menu to choose from.
 */
exports.getMyServices = async (req, res) => {
    try {
        const member = await myMemberDoc(req);
        if (!member) return res.status(404).json({ success: false, message: 'No staff profile found' });
        const services = await Service.find({ provider: req.user.staffOf, isActive: { $ne: false } })
            .select('name').sort({ name: 1 });
        res.status(200).json({
            success: true,
            data: { selected: (member.services || []).map(String), services },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * PUT /api/team/mine/services  (staff-self)
 * Body: { services: [serviceId] } — [] means "performs all business services".
 * A member sets their OWN service list; every id must be one of the business's.
 */
exports.setMyServices = async (req, res) => {
    try {
        const { services } = req.body;
        if (!Array.isArray(services)) {
            return res.status(400).json({ success: false, message: 'services must be an array of service ids' });
        }
        const member = await myMemberDoc(req);
        if (!member) return res.status(404).json({ success: false, message: 'No staff profile found' });

        if (services.length) {
            const owned = await Service.countDocuments({ _id: { $in: services }, provider: req.user.staffOf });
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
        // An inverted range (start ≥ end) used to save silently and left the
        // member bookable at no valid time — refuse it and name the day, so the
        // mistake is caught while the owner is still looking at the form.
        const toMins = (t) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
        for (const [day, cfg] of Object.entries(schedule)) {
            if (!cfg?.enabled) continue;
            const label = day.charAt(0).toUpperCase() + day.slice(1);
            for (const slot of cfg.slots || []) {
                if (toMins(slot.end) <= toMins(slot.start)) {
                    return res.status(400).json({ success: false, message: `${label}: the ending time (${slot.end}) must be after the starting time (${slot.start}). Swap them if they're reversed.` });
                }
            }
            // Overlapping slots would double-count the day and make occupancy stats
            // nonsense (scheduledMinutes sums each slot with no interval merge), the
            // same reason shift periods reject overlap — so refuse them here too.
            const sorted = [...(cfg.slots || [])].sort((a, b) => toMins(a.start) - toMins(b.start));
            for (let i = 1; i < sorted.length; i += 1) {
                if (toMins(sorted[i].start) < toMins(sorted[i - 1].end)) {
                    return res.status(400).json({ success: false, message: `${label}: two working periods overlap. Please make them separate, non-overlapping times.` });
                }
            }
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
