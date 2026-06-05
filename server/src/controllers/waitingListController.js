const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const WaitingList = require('../models/WaitingList');
const Appointment = require('../models/Appointment');

// Join the waiting list for a slot
exports.joinWaitingList = async (req, res) => {
    try {
        const { service, appointmentDate, startTime, endTime } = req.body;

        // Check the slot is actually taken
        const existingAppointment = await Appointment.findOne({
            service,
            appointmentDate: new Date(appointmentDate),
            startTime,
            status: { $nin: ['cancelled'] },
        });

        if (!existingAppointment) {
            return res.status(400).json({
                success: false,
                message: 'This slot is still available — just book it directly!',
            });
        }

        // Check customer isn't already on the waiting list for this slot
        const alreadyWaiting = await WaitingList.findOne({
            service,
            appointmentDate: new Date(appointmentDate),
            startTime,
            customer: req.user._id,
            status: 'waiting',
        });

        if (alreadyWaiting) {
            return res.status(400).json({
                success: false,
                message: 'You are already on the waiting list for this slot',
            });
        }

        // Calculate position
        const waitingCount = await WaitingList.countDocuments({
            service,
            appointmentDate: new Date(appointmentDate),
            startTime,
            status: 'waiting',
        });

        const entry = await WaitingList.create({
            service,
            customer: req.user._id,
            appointmentDate: new Date(appointmentDate),
            startTime,
            endTime,
            position: waitingCount + 1,
        });

        await entry.populate('service', 'name price duration');

        res.status(201).json({ success: true, data: entry });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Get current user's waiting list entries
exports.getMyWaitingList = async (req, res) => {
    try {
        const entries = await WaitingList.find({
            customer: req.user._id,
            status: 'waiting',
        })
            .populate('service', 'name price duration')
            .sort({ appointmentDate: 1, position: 1 });

        res.status(200).json({ success: true, count: entries.length, data: entries });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Leave the waiting list
exports.leaveWaitingList = async (req, res) => {
    try {
        const entry = await WaitingList.findOne({
            _id: req.params.id,
            customer: req.user._id,
        });

        if (!entry) {
            return res.status(404).json({ success: false, message: 'Waiting list entry not found' });
        }

        entry.status = 'cancelled';
        await entry.save();

        // Reorder positions for remaining entries in this slot
        const remaining = await WaitingList.find({
            service: entry.service,
            appointmentDate: entry.appointmentDate,
            startTime: entry.startTime,
            status: 'waiting',
        }).sort({ position: 1 });

        for (let i = 0; i < remaining.length; i++) {
            remaining[i].position = i + 1;
            await remaining[i].save();
        }

        res.status(200).json({ success: true, message: 'Removed from waiting list' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Called internally when an appointment is cancelled
exports.promoteFromWaitingList = async (service, appointmentDate, startTime, endTime) => {
    try {
        // Find #1 in the queue for this slot
        const next = await WaitingList.findOne({
            service,
            appointmentDate,
            startTime,
            status: 'waiting',
            position: 1,
        }).populate('customer');

        if (!next) return; // Nobody waiting

        // Create appointment for them
        const promoted = await Appointment.create({
            customer: next.customer._id,
            service,
            appointmentDate,
            startTime,
            endTime,
            totalPrice: 0, // Will be set from service
            status: 'confirmed',
        });

        // Mark them as promoted and notified
        next.status = 'promoted';
        next.notified = true;
        await next.save();

        // Shift everyone else up
        const remaining = await WaitingList.find({
            service,
            appointmentDate,
            startTime,
            status: 'waiting',
        }).sort({ position: 1 });

        for (let i = 0; i < remaining.length; i++) {
            remaining[i].position = i + 1;
            await remaining[i].save();
        }

        logger.info({ customer: next.customer.name, appointmentId: promoted._id }, 'Promoted from waiting list');
    } catch (error) {
        logger.error({ err: error }, 'Error promoting from waiting list');
    }
};

// Get in-app notifications (promoted entries)
exports.getNotifications = async (req, res) => {
    try {
        const notifications = await WaitingList.find({
            customer: req.user._id,
            status: 'promoted',
            notified: true,
        })
            .populate('service', 'name')
            .sort({ updatedAt: -1 });

        res.status(200).json({ success: true, data: notifications });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};