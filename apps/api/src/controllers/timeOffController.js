const mongoose = require('mongoose');
const TimeOff = require('../models/TimeOff');
const TeamMember = require('../models/TeamMember');
const Appointment = require('../models/Appointment');

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TYPES = ['vacation', 'sick', 'unpaid', 'training', 'other'];
// A year of leave in one row is already extreme; the cap mostly exists to stop a
// typo'd year ("9999") silently closing a calendar for decades — and to bound
// the per-day expansion loop in the public shift-days feed.
const MAX_RANGE_DAYS = 366;
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00.000Z`) - new Date(`${a}T00:00:00.000Z`)) / 86400000) + 1;

// A regex accepts 2026-02-31; round-trip through a UTC Date so only real days pass.
const realDate = (s) => {
    if (!DATE_KEY.test(s || '')) return false;
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

/** Validate and normalise a leave body, or return { error }. */
const parseLeave = (body) => {
    const { startDate, endDate } = body;
    if (!realDate(startDate) || !realDate(endDate)) {
        return { error: 'startDate and endDate must be real calendar dates as YYYY-MM-DD' };
    }
    if (endDate < startDate) return { error: 'endDate cannot be before startDate' };
    if (daysBetween(startDate, endDate) > MAX_RANGE_DAYS) {
        return { error: `A single time-off entry can span at most ${MAX_RANGE_DAYS} days` };
    }

    // Only a real boolean turns off all-day; a string 'false' used to slip through
    // and silently close the whole day while discarding the caller's times.
    if (body.allDay !== undefined && typeof body.allDay !== 'boolean') {
        return { error: 'allDay must be true or false' };
    }
    const allDay = body.allDay !== false; // default true
    let startTime = null;
    let endTime = null;
    if (!allDay) {
        startTime = body.startTime;
        endTime = body.endTime;
        if (!HHMM.test(startTime || '') || !HHMM.test(endTime || '')) {
            return { error: 'A timed leave needs a start and end as HH:MM' };
        }
        if (toMin(endTime) <= toMin(startTime)) return { error: 'Leave must end after it starts' };
    } else if (body.startTime != null || body.endTime != null) {
        // Times sent with an all-day leave are a caller mistake, not something to
        // silently drop — say so rather than store a contradiction.
        return { error: 'Remove the start/end times for an all-day leave, or set allDay to false' };
    }

    // An unknown type used to be coerced to 'vacation' — a sick day silently
    // filed as a holiday. Reject it so the record means what was chosen.
    if (body.type !== undefined && !TYPES.includes(body.type)) {
        return { error: `type must be one of: ${TYPES.join(', ')}` };
    }
    const type = body.type || 'vacation';
    const note = String(body.note == null ? '' : body.note).slice(0, 200);
    return { value: { startDate, endDate, allDay, startTime, endTime, type, note } };
};

const shape = (t) => ({
    _id: t._id, startDate: t.startDate, endDate: t.endDate, allDay: t.allDay,
    startTime: t.startTime, endTime: t.endTime, type: t.type, note: t.note,
    status: t.status, requestedBy: t.requestedBy, teamMember: t.teamMember,
    createdAt: t.createdAt,
});

/**
 * How many of the member's own bookings a leave would sit on top of. Approving
 * leave does NOT touch existing bookings — the owner still has to reschedule or
 * cancel them — so this count is surfaced as a warning rather than acted on.
 * Counts a booking whether the member is its top-level performer or a segment
 * performer; a windowed leave only counts bookings whose time overlaps it.
 */
const overlappingBookingCount = async (member, leave) => {
    const dayStart = new Date(`${leave.startDate}T00:00:00.000Z`);
    const dayEnd = new Date(`${leave.endDate}T23:59:59.999Z`);
    const appts = await Appointment.find({
        $or: [{ teamMember: member._id }, { 'services.teamMember': member._id }],
        appointmentDate: { $gte: dayStart, $lte: dayEnd },
        status: { $in: ['pending', 'confirmed'] },
    }).select('startTime endTime').lean();
    if (leave.allDay) return appts.length;
    const ls = toMin(leave.startTime);
    const le = toMin(leave.endTime);
    return appts.filter((a) => toMin(a.startTime) < le && toMin(a.endTime) > ls).length;
};

// ───────────────────────── owner (provider/admin) ─────────────────────────

const ownerMember = (req) => (mongoose.isValidObjectId(req.params.id)
    ? TeamMember.findOne({ _id: req.params.id, provider: req.user._id })
    : null);

exports.listTimeOff = async (req, res) => {
    try {
        const member = await ownerMember(req);
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        const q = { teamMember: member._id };
        // Optional window: keep leave that overlaps [from, to] (inclusive).
        const { from, to } = req.query;
        if (realDate(from) && realDate(to)) { q.startDate = { $lte: to }; q.endDate = { $gte: from }; }

        const rows = await TimeOff.find(q).sort({ startDate: 1 }).lean();
        res.status(200).json({ success: true, data: rows.map(shape) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.createTimeOff = async (req, res) => {
    try {
        const member = await ownerMember(req);
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        const parsed = parseLeave(req.body);
        if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

        // Owner-set leave is approved on the spot — the owner IS the approver.
        const doc = await TimeOff.create({
            ...parsed.value, provider: req.user._id, teamMember: member._id,
            status: 'approved', requestedBy: 'owner', decidedBy: req.user._id, decidedAt: new Date(),
        });
        const overlaps = await overlappingBookingCount(member, parsed.value);
        res.status(201).json({ success: true, data: shape(doc), overlappingBookings: overlaps });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.decideTimeOff = async (req, res) => {
    try {
        const member = await ownerMember(req);
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        const status = req.body.status;
        if (status !== 'approved' && status !== 'declined') {
            return res.status(400).json({ success: false, message: 'status must be approved or declined' });
        }
        if (!mongoose.isValidObjectId(req.params.toId)) {
            return res.status(404).json({ success: false, message: 'No pending request to decide' });
        }
        // Only a pending request can be decided — approving an approved leave, or
        // re-deciding a declined one, is a no-op the UI should never send.
        const updated = await TimeOff.findOneAndUpdate(
            { _id: req.params.toId, teamMember: member._id, status: 'pending' },
            { $set: { status, decidedBy: req.user._id, decidedAt: new Date() } },
            { new: true },
        );
        if (!updated) return res.status(404).json({ success: false, message: 'No pending request to decide' });
        // Approving leave doesn't move existing bookings; warn how many now clash.
        const overlaps = status === 'approved' ? await overlappingBookingCount(member, updated) : 0;
        res.status(200).json({ success: true, data: shape(updated), overlappingBookings: overlaps });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deleteTimeOff = async (req, res) => {
    try {
        const member = await ownerMember(req);
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        if (!mongoose.isValidObjectId(req.params.toId)) {
            return res.status(404).json({ success: false, message: 'Time off not found' });
        }
        const del = await TimeOff.deleteOne({ _id: req.params.toId, teamMember: member._id });
        if (!del.deletedCount) return res.status(404).json({ success: false, message: 'Time off not found' });
        res.status(200).json({ success: true, message: 'Time off removed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// ───────────────────────── staff self-service ─────────────────────────

// The team-member record for the signed-in staff principal, scoped to the
// business they work for. A provider/owner has none — self-service is staff-only.
const myMember = (req) => (req.user.staffOf
    ? TeamMember.findOne({ user: req.user._id, provider: req.user.staffOf })
    : null);

exports.listMyTimeOff = async (req, res) => {
    try {
        const member = await myMember(req);
        if (!member) return res.status(200).json({ success: true, data: [] });
        const rows = await TimeOff.find({ teamMember: member._id }).sort({ startDate: 1 }).lean();
        res.status(200).json({ success: true, data: rows.map(shape) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.requestTimeOff = async (req, res) => {
    try {
        const member = await myMember(req);
        if (!member) return res.status(403).json({ success: false, message: 'Only staff can request time off' });

        const parsed = parseLeave(req.body);
        if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

        // A staff request starts pending — it does not close their calendar until
        // the owner approves it.
        const doc = await TimeOff.create({
            ...parsed.value, provider: req.user.staffOf, teamMember: member._id,
            status: 'pending', requestedBy: 'staff',
        });
        res.status(201).json({ success: true, data: shape(doc) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.cancelMyTimeOff = async (req, res) => {
    try {
        const member = await myMember(req);
        if (!member) return res.status(403).json({ success: false, message: 'Only staff can withdraw time off' });

        if (!mongoose.isValidObjectId(req.params.toId)) {
            return res.status(404).json({ success: false, message: 'No pending request to withdraw' });
        }
        // Staff may withdraw their OWN request while it is still pending. Removing
        // leave the owner has already approved is the owner's call, not theirs.
        const del = await TimeOff.deleteOne({ _id: req.params.toId, teamMember: member._id, status: 'pending' });
        if (!del.deletedCount) return res.status(404).json({ success: false, message: 'No pending request to withdraw' });
        res.status(200).json({ success: true, message: 'Request withdrawn' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
