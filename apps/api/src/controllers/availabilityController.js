const Availability = require('../models/Availability');

const defaultSlot = { start: '09:00', end: '17:00' };

const defaultSchedule = {
    monday:    { enabled: true,  slots: [defaultSlot] },
    tuesday:   { enabled: true,  slots: [defaultSlot] },
    wednesday: { enabled: true,  slots: [defaultSlot] },
    thursday:  { enabled: true,  slots: [defaultSlot] },
    friday:    { enabled: true,  slots: [defaultSlot] },
    saturday:  { enabled: false, slots: [defaultSlot] },
    sunday:    { enabled: false, slots: [defaultSlot] },
};

exports.getMyAvailability = async (req, res) => {
    try {
        let availability = await Availability.findOne({ provider: req.user._id });

        if (!availability) {
            availability = await Availability.create({
                provider: req.user._id,
                schedule: defaultSchedule,
            });
        }

        res.status(200).json({ success: true, data: availability });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

// The business's opening hours must read back exactly as the owner set them.
// Before, anything was stored: a day switched on with no times (the screen showed
// 09:00–17:00, clients saw it closed), a closing time before the opening time
// (the screen showed it, New Appointment and clients silently ignored it), or a
// period with no end. Each of those made the Working Hours screen say one thing
// and New Appointment, the calendar and the client booking page another.
const scheduleError = (schedule) => {
    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return 'schedule is required';
    for (const [day, cfg] of Object.entries(schedule)) {
        if (!DAYS.includes(day)) return `Unknown day "${day}"`;
        if (!cfg?.enabled) continue;
        const label = day.charAt(0).toUpperCase() + day.slice(1);
        const slots = Array.isArray(cfg.slots) ? cfg.slots : [];
        if (!slots.length) return `${label}: set the opening and closing time, or switch the day off.`;
        for (const slot of slots) {
            if (!HHMM.test(String(slot?.start)) || !HHMM.test(String(slot?.end))) {
                return `${label}: times must be HH:mm, 24-hour (e.g. 08:30).`;
            }
            if (toMins(slot.end) <= toMins(slot.start)) {
                return `${label}: the closing time (${slot.end}) must be after the opening time (${slot.start}).`;
            }
        }
        const sorted = [...slots].sort((a, b) => toMins(a.start) - toMins(b.start));
        for (let i = 1; i < sorted.length; i += 1) {
            if (toMins(sorted[i].start) < toMins(sorted[i - 1].end)) return `${label}: two opening periods overlap.`;
        }
    }
    return null;
};
exports._scheduleError = scheduleError;

exports.updateMyAvailability = async (req, res) => {
    try {
        const { schedule } = req.body;
        const err = scheduleError(schedule);
        if (err) return res.status(400).json({ success: false, message: err });

        const availability = await Availability.findOneAndUpdate(
            { provider: req.user._id },
            { schedule },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, data: availability });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getProviderAvailability = async (req, res) => {
    try {
        // Route is public: reject malformed ids up front so drive-by requests
        // get a 400 instead of a CastError-driven 500 (which pages the alerts).
        if (!require('mongoose').isValidObjectId(req.params.providerId)) {
            return res.status(400).json({ success: false, message: 'Invalid provider id' });
        }
        const availability = await Availability.findOne({ provider: req.params.providerId });

        if (!availability) {
            return res.status(200).json({ success: true, data: { schedule: defaultSchedule } });
        }

        res.status(200).json({ success: true, data: availability });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};