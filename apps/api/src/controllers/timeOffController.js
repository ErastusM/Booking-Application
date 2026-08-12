const TimeOff = require('../models/TimeOff');
const TeamMember = require('../models/TeamMember');

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TYPES = ['vacation', 'sick', 'unpaid', 'training', 'other'];

// A regex accepts 2026-02-31; round-trip through a UTC Date so only real days pass.
const realDate = (s) => {
    if (!DATE_KEY.test(s || '')) return false;
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

/** Validate and normalise a leave body, or return { error }. */
const parseLeave = (body) => {
    const { startDate, endDate, note } = body;
    if (!realDate(startDate) || !realDate(endDate)) {
        return { error: 'startDate and endDate must be real calendar dates as YYYY-MM-DD' };
    }
    if (endDate < startDate) return { error: 'endDate cannot be before startDate' };

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
    }

    const type = TYPES.includes(body.type) ? body.type : 'vacation';
    return {
        value: { startDate, endDate, allDay, startTime, endTime, type, note: (note || '').slice(0, 200) },
    };
};

const shape = (t) => ({
    _id: t._id, startDate: t.startDate, endDate: t.endDate, allDay: t.allDay,
    startTime: t.startTime, endTime: t.endTime, type: t.type, note: t.note,
    status: t.status, requestedBy: t.requestedBy, teamMember: t.teamMember,
    createdAt: t.createdAt,
});

// ───────────────────────── owner (provider/admin) ─────────────────────────

const ownerMember = (req) => TeamMember.findOne({ _id: req.params.id, provider: req.user._id });

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
        res.status(201).json({ success: true, data: shape(doc) });
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
        // Only a pending request can be decided — approving an approved leave, or
        // re-deciding a declined one, is a no-op the UI should never send.
        const updated = await TimeOff.findOneAndUpdate(
            { _id: req.params.toId, teamMember: member._id, status: 'pending' },
            { $set: { status, decidedBy: req.user._id, decidedAt: new Date() } },
            { new: true },
        );
        if (!updated) return res.status(404).json({ success: false, message: 'No pending request to decide' });
        res.status(200).json({ success: true, data: shape(updated) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deleteTimeOff = async (req, res) => {
    try {
        const member = await ownerMember(req);
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

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

        // Staff may withdraw their OWN request while it is still pending. Removing
        // leave the owner has already approved is the owner's call, not theirs.
        const del = await TimeOff.deleteOne({ _id: req.params.toId, teamMember: member._id, status: 'pending' });
        if (!del.deletedCount) return res.status(404).json({ success: false, message: 'No pending request to withdraw' });
        res.status(200).json({ success: true, message: 'Request withdrawn' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
