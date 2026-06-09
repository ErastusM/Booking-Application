const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const WaitingList = require('../models/WaitingList');
const Appointment = require('../models/Appointment');
const Service = require('../models/Service');
const { createNotification } = require('../utils/notificationhelper');

const toMinutes = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
};

// Join the waiting list for a slot
exports.joinWaitingList = async (req, res) => {
    try {
        const { service, appointmentDate, startTime, endTime } = req.body;
        let { provider } = req.body;

        const svc = await Service.findById(service).select('name provider');
        if (!svc) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }
        if (!provider) provider = svc.provider;

        const dateObj = new Date(appointmentDate);
        const dayStart = new Date(appointmentDate); dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(appointmentDate); dayEnd.setHours(23, 59, 59, 999);

        // Confirm the slot is actually taken — provider-aware time overlap when the
        // provider is known (matches how the booking page greys out slots).
        let slotTaken = false;
        if (provider) {
            const nStart = toMinutes(startTime);
            const nEnd = toMinutes(endTime || startTime);
            const existing = await Appointment.find({
                provider,
                appointmentDate: { $gte: dayStart, $lte: dayEnd },
                status: { $nin: ['cancelled'] },
            }).select('startTime endTime');
            slotTaken = existing.some(a => nStart < toMinutes(a.endTime) && nEnd > toMinutes(a.startTime));
        } else {
            const existingAppointment = await Appointment.findOne({
                service,
                appointmentDate: dateObj,
                startTime,
                status: { $nin: ['cancelled'] },
            });
            slotTaken = !!existingAppointment;
        }

        if (!slotTaken) {
            return res.status(400).json({
                success: false,
                message: 'This slot is still available — just book it directly!',
            });
        }

        // Check customer isn't already on the waiting list for this slot
        const alreadyWaiting = await WaitingList.findOne({
            service,
            appointmentDate: dateObj,
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
            appointmentDate: dateObj,
            startTime,
            status: 'waiting',
        });

        const entry = await WaitingList.create({
            service,
            provider: provider || null,
            customer: req.user._id,
            appointmentDate: dateObj,
            startTime,
            endTime,
            position: waitingCount + 1,
        });

        await entry.populate('service', 'name price duration');

        // Notify the provider that a customer joined their waiting list
        if (provider) {
            const when = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            await createNotification(
                provider,
                `${req.user.name} joined the waiting list for ${svc.name} on ${when} at ${startTime}.`,
                'waiting_list',
                '/dashboard'
            );
        }

        res.status(201).json({ success: true, data: entry });
    } catch (error) {
        logger.error({ err: error }, 'Error joining waiting list');
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