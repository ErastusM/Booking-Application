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

const { weekError, sortedWeek } = require('../utils/weeklyHours');

// The business's opening hours must read back exactly as the owner set them.
// Before, anything was stored: a day switched on with no times (the screen showed
// 09:00–17:00, clients saw it closed), a closing time before the opening time
// (the screen showed it, New Appointment and clients silently ignored it), or a
// period with no end. Each of those made the Working Hours screen say one thing
// and New Appointment, the calendar and the client booking page another. The
// same check (utils/weeklyHours) holds a team member's own hours.
const scheduleError = (schedule) => weekError(schedule, { kind: 'business' });
exports._scheduleError = scheduleError;

exports.updateMyAvailability = async (req, res) => {
    try {
        const { schedule } = req.body;
        const err = scheduleError(schedule);
        if (err) return res.status(400).json({ success: false, message: err });

        // Each day's periods in time order — a split day reads back exactly as
        // the Working Hours screen shows it (08:00–12:00, then 14:00–18:00).
        const availability = await Availability.findOneAndUpdate(
            { provider: req.user._id },
            { schedule: sortedWeek(schedule) },
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