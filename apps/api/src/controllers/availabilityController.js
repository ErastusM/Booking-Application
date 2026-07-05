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

exports.updateMyAvailability = async (req, res) => {
    try {
        const { schedule } = req.body;

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
        const availability = await Availability.findOne({ provider: req.params.providerId });

        if (!availability) {
            return res.status(200).json({ success: true, data: { schedule: defaultSchedule } });
        }

        res.status(200).json({ success: true, data: availability });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};