const TimeClock = require('../models/TimeClock');
const TeamMember = require('../models/TeamMember');

// The signed-in staff member's own roster row (token-scoped, no id in the URL),
// mirroring timeOffController.myMember. A provider (no staffOf) has none.
const myMember = (req) => (req.user.staffOf
    ? TeamMember.findOne({ user: req.user._id, provider: req.user.staffOf })
    : null);

const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
const shape = (e) => ({
    _id: e._id,
    clockIn: e.clockIn,
    clockOut: e.clockOut,
    note: e.note || '',
    // Open entries have no duration yet (null, not 0 — "still running" ≠ "0 min").
    minutes: e.clockOut ? minutesBetween(e.clockIn, e.clockOut) : null,
});

// Parse an optional YYYY-MM-DD window into a clockIn filter. Absent → last 30 days.
const windowFilter = (from, to) => {
    const filter = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) filter.$gte = new Date(`${from}T00:00:00.000Z`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) filter.$lte = new Date(`${to}T23:59:59.999Z`);
    if (!filter.$gte) { const d = new Date(); d.setUTCDate(d.getUTCDate() - 30); filter.$gte = d; }
    return { clockIn: filter };
};

// GET /api/timeclock/mine — my status (open entry) + entries in the window + total.
exports.getMyTimeclock = async (req, res) => {
    try {
        const member = await myMember(req);
        if (!member) return res.status(200).json({ success: true, data: { open: null, entries: [], totalMinutes: 0 } });
        const entries = await TimeClock.find({ teamMember: member._id, ...windowFilter(req.query.from, req.query.to) })
            .sort({ clockIn: -1 }).lean();
        const open = entries.find((e) => !e.clockOut) || await TimeClock.findOne({ teamMember: member._id, clockOut: null }).lean();
        const totalMinutes = entries.reduce((sum, e) => sum + (e.clockOut ? minutesBetween(e.clockIn, e.clockOut) : 0), 0);
        res.status(200).json({ success: true, data: { open: open ? shape(open) : null, entries: entries.map(shape), totalMinutes } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/timeclock/mine/in — start a shift. Refuses a second open entry.
exports.clockIn = async (req, res) => {
    try {
        const member = await myMember(req);
        if (!member) return res.status(404).json({ success: false, message: 'No staff profile found' });
        const existing = await TimeClock.findOne({ teamMember: member._id, clockOut: null });
        if (existing) {
            return res.status(400).json({ success: false, message: "You're already clocked in. Clock out first." });
        }
        const entry = await TimeClock.create({
            provider: member.provider,
            teamMember: member._id,
            clockIn: new Date(),
            note: typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 200) : '',
        });
        res.status(201).json({ success: true, data: shape(entry) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/timeclock/mine/out — close the open shift. Refuses if none open.
exports.clockOut = async (req, res) => {
    try {
        const member = await myMember(req);
        if (!member) return res.status(404).json({ success: false, message: 'No staff profile found' });
        const open = await TimeClock.findOne({ teamMember: member._id, clockOut: null }).sort({ clockIn: -1 });
        if (!open) {
            return res.status(400).json({ success: false, message: "You're not clocked in." });
        }
        open.clockOut = new Date();
        if (typeof req.body.note === 'string' && req.body.note.trim()) open.note = req.body.note.trim().slice(0, 200);
        await open.save();
        res.status(200).json({ success: true, data: shape(open) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/timeclock/:memberId — OWNER views a member's timesheet. Scoped to the
// caller as provider, so a staff member (whose _id is not a provider) gets 404
// for anyone — the owner-only gate is the scoping, not a role check here.
exports.getMemberTimeclock = async (req, res) => {
    try {
        const member = await TeamMember.findOne({ _id: req.params.memberId, provider: req.user._id });
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
        const entries = await TimeClock.find({ teamMember: member._id, provider: req.user._id, ...windowFilter(req.query.from, req.query.to) })
            .sort({ clockIn: -1 }).lean();
        const open = await TimeClock.findOne({ teamMember: member._id, clockOut: null }).lean();
        const totalMinutes = entries.reduce((sum, e) => sum + (e.clockOut ? minutesBetween(e.clockIn, e.clockOut) : 0), 0);
        res.status(200).json({ success: true, data: { open: open ? shape(open) : null, entries: entries.map(shape), totalMinutes } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
