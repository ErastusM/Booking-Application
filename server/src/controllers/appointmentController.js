const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const Appointment = require('../models/Appointment');
const Availability = require('../models/Availability');
const Service = require('../models/Service');
const User = require('../models/User');
const { createNotification, notifyAdmins } = require('../utils/notificationhelper');
const {
    sendAppointmentConfirmed,
    sendAppointmentCompleted,
    sendAppointmentCancelled,
    sendAppointmentRescheduled,
    sendRebookingPrompt,
} = require('../utils/emailService');

const defaultSchedule = {
    monday:    { enabled: true,  slots: [{ start: '09:00', end: '17:00' }] },
    tuesday:   { enabled: true,  slots: [{ start: '09:00', end: '17:00' }] },
    wednesday: { enabled: true,  slots: [{ start: '09:00', end: '17:00' }] },
    thursday:  { enabled: true,  slots: [{ start: '09:00', end: '17:00' }] },
    friday:    { enabled: true,  slots: [{ start: '09:00', end: '17:00' }] },
    saturday:  { enabled: false, slots: [{ start: '09:00', end: '17:00' }] },
    sunday:    { enabled: false, slots: [{ start: '09:00', end: '17:00' }] },
};

const parseTimeToMinutes = (time) => {
    const [h, m] = String(time).split(':').map(Number);
    return h * 60 + m;
};

const timesOverlap = (startA, endA, startB, endB) => startA < endB && endA > startB;

const getProviderSchedule = async (providerId) => {
    if (!providerId) return defaultSchedule;
    const availability = await Availability.findOne({ provider: providerId });
    return availability?.schedule || defaultSchedule;
};

const isTimeWithinSchedule = (schedule, appointmentDate, startTime, durationMinutes) => {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayIndex = new Date(appointmentDate).getDay();
    const daySchedule = schedule[dayNames[dayIndex]];
    if (!daySchedule?.enabled || !Array.isArray(daySchedule.slots) || daySchedule.slots.length === 0) {
        return false;
    }
    const start = parseTimeToMinutes(startTime);
    const end = start + durationMinutes;
    return daySchedule.slots.some(slot => {
        const slotStart = parseTimeToMinutes(slot.start);
        const slotEnd = parseTimeToMinutes(slot.end);
        return start >= slotStart && end <= slotEnd;
    });
};

const hasConflictingAppointment = async (providerId, appointmentDate, startTime, endTime, excludeId) => {
    if (!providerId) return false;
    const start = new Date(appointmentDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(appointmentDate);
    end.setHours(23, 59, 59, 999);
    const existing = await Appointment.find({
        provider: providerId,
        appointmentDate: { $gte: start, $lte: end },
        status: { $nin: ['cancelled'] },
        _id: { $ne: excludeId },
    }).select('startTime endTime');
    const newStart = parseTimeToMinutes(startTime);
    const newEnd = parseTimeToMinutes(endTime);
    return existing.some(a => timesOverlap(newStart, newEnd, parseTimeToMinutes(a.startTime), parseTimeToMinutes(a.endTime)));
};

/**
 * GET /api/appointments/booked-slots?providerId=&date=YYYY-MM-DD
 * Public — returns start/end times of all non-cancelled appointments for a provider on a given date.
 * Used by the booking page to grey out taken time slots.
 */
exports.getBookedSlots = async (req, res) => {
    try {
        const { providerId, date } = req.query;
        if (!providerId || !date) {
            return res.status(400).json({ success: false, message: 'providerId and date are required' });
        }
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);

        const appointments = await Appointment.find({
            provider: providerId,
            appointmentDate: { $gte: start, $lte: end },
            status: { $nin: ['cancelled'] },
        }).select('startTime endTime -_id');

        res.status(200).json({ success: true, data: appointments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getAllAppointments = async (req, res) => {
    try {
        let query = {};
        if (req.user.role === 'customer') {
            query = { customer: req.user._id };
        } else if (req.user.role === 'provider') {
            query = { provider: req.user._id };
        }

        const { status } = req.query;
        if (status && ['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
            query.status = status;
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [appointments, total] = await Promise.all([
            Appointment.find(query)
                .populate('customer', 'name email phone')
                .populate('service', 'name price duration')
                .sort({ appointmentDate: -1 })
                .skip(skip)
                .limit(limit),
            Appointment.countDocuments(query),
        ]);
        res.status(200).json({
            success: true,
            count: appointments.length,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: appointments,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getMyAppointments = async (req, res) => {
    try {
        const appointments = await Appointment.find({ customer: req.user._id })
            .populate('customer', 'name email phone')
            .populate('service', 'name price duration')
            .sort({ appointmentDate: -1 });

        res.status(200).json({
            success: true,
            count: appointments.length,
            data: appointments,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.createAppointment = async (req, res) => {
    try {
        const { service, appointmentDate, startTime, endTime, notes, selectedAddOns, walkInName } = req.body;
        if (!service || !appointmentDate || !startTime || !endTime) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }
        const svc = await Service.findById(service);
        if (!svc) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }
        const isProviderBooking = req.user.role === 'provider';

        // Block double-bookings: check provider time overlap (not just same service+time)
        const providerId = svc.provider;
        if (providerId) {
            const [newSH, newSM] = startTime.split(':').map(Number);
            const [newEH, newEM] = endTime.split(':').map(Number);
            const newStart = newSH * 60 + newSM;
            const newEnd = newEH * 60 + newEM;
            const dayStart = new Date(appointmentDate); dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(appointmentDate); dayEnd.setHours(23, 59, 59, 999);
            const existing = await Appointment.find({
                provider: providerId,
                appointmentDate: { $gte: dayStart, $lte: dayEnd },
                status: { $nin: ['cancelled'] },
            }).select('startTime endTime');
            const hasOverlap = existing.some(a => {
                const [aSH, aSM] = a.startTime.split(':').map(Number);
                const [aEH, aEM] = a.endTime.split(':').map(Number);
                const aStart = aSH * 60 + aSM;
                const aEnd = aEH * 60 + aEM;
                return newStart < aEnd && newEnd > aStart;
            });
            if (hasOverlap) {
                return res.status(400).json({ success: false, message: 'This time slot is already booked. You can join the waiting list instead.' });
            }
        } else {
            // Fallback for services without a provider: check by service+time
            const existingAppointment = await Appointment.findOne({
                service,
                appointmentDate: new Date(appointmentDate),
                startTime,
                status: { $nin: ['cancelled'] },
            });
            if (existingAppointment) {
                return res.status(400).json({ success: false, message: 'This time slot is already booked. You can join the waiting list instead.' });
            }
        }

        const appointment = await Appointment.create({
            customer: req.user._id,
            service,
            provider: svc.provider || null,
            appointmentDate: new Date(appointmentDate),
            startTime,
            endTime,
            notes: notes || '',
            selectedAddOns: Array.isArray(selectedAddOns) ? selectedAddOns : [],
            totalPrice: (svc.price || 0) + (Array.isArray(selectedAddOns) ? selectedAddOns.reduce((sum, a) => sum + (a.price || 0), 0) : 0),
            // Provider walk-in bookings are immediately confirmed; customer bookings are confirmed too
            status: 'confirmed',
            walkInName: isProviderBooking ? (walkInName?.trim() || null) : null,
        });
        await appointment.populate(['service', { path: 'customer', select: 'name email' }]);

        // Notify the provider (in-app) and alert admins of the new booking
        try {
            const bookingDate = new Date(appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (svc.provider) {
                await createNotification(
                    svc.provider,
                    `New booking: ${req.user.name} booked ${svc.name} on ${bookingDate} at ${startTime}`,
                    'appointment',
                    '/dashboard'
                );
            }
            await notifyAdmins(
                `New booking: ${svc.name} by ${req.user.name} on ${bookingDate} at ${startTime}`,
                'system',
                '/bkplus-command'
            );
        } catch (_) { /* notifications must not break the booking */ }

        // Send confirmation email immediately
        try {
            const dateStr = new Date(appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            const timeStr = `${startTime} – ${endTime}`;
            const _pad = (n) => String(n).padStart(2, '0');
            const _fmt = (d) => `${d.getFullYear()}${_pad(d.getMonth()+1)}${_pad(d.getDate())}T${_pad(d.getHours())}${_pad(d.getMinutes())}00`;
            const _base = new Date(appointmentDate);
            const [_sh, _sm] = startTime.split(':').map(Number);
            const [_eh, _em] = endTime.split(':').map(Number);
            const _gcalStart = new Date(_base.getFullYear(), _base.getMonth(), _base.getDate(), _sh, _sm);
            const _gcalEnd = new Date(_base.getFullYear(), _base.getMonth(), _base.getDate(), _eh, _em);
            const gcalUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(svc.name)}&dates=${_fmt(_gcalStart)}/${_fmt(_gcalEnd)}&details=${encodeURIComponent('Booked via Bookplus')}`;
            await sendAppointmentConfirmed(
                req.user.email,
                req.user.name,
                svc.name,
                dateStr,
                timeStr,
                gcalUrl
            );
        } catch (_) { /* email failure must not break the booking */ }

        res.status(201).json({ success: true, message: 'Appointment confirmed', data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findById(req.params.id);
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        if (appointment.customer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized to update this appointment' });
        }
        const { appointmentDate, startTime, endTime, status, notes } = req.body;
        appointment.appointmentDate = appointmentDate || appointment.appointmentDate;
        appointment.startTime = startTime || appointment.startTime;
        appointment.endTime = endTime || appointment.endTime;
        appointment.status = status || appointment.status;
        appointment.notes = notes !== undefined ? notes : appointment.notes;
        await appointment.save();
        res.status(200).json({ success: true, message: 'Appointment updated successfully', data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.cancelAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findById(req.params.id)
            .populate('customer', 'name email')
            .populate('service', 'name');
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        if (appointment.customer._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized to cancel this appointment' });
        }
        appointment.status = 'cancelled';
        appointment.cancellationReason = req.body.cancellationReason || '';
        await appointment.save();

        const { promoteFromWaitingList } = require('../utils/waitingListHelper');
        await promoteFromWaitingList(
            appointment.service._id,
            appointment.appointmentDate,
            appointment.startTime,
            appointment.endTime
        );

        // Send cancellation email
        try {
            const date = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            await sendAppointmentCancelled(
                appointment.customer.email,
                appointment.customer.name,
                appointment.service.name,
                date
            );
        } catch (emailErr) {
            logger.error({ err: emailErr }, 'Cancel email failed');
        }

        res.status(200).json({ success: true, message: 'Appointment cancelled successfully', data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateAppointmentStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const appointment = await Appointment.findById(req.params.id)
            .populate('customer', 'name email')
            .populate('service', 'name');
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        if (req.user.role !== 'admin' && appointment.provider?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        appointment.status = status;
        await appointment.save();

        // If cancelling via status update, promote waiting list just like direct cancel
        if (status === 'cancelled') {
            const { promoteFromWaitingList } = require('../utils/waitingListHelper');
            await promoteFromWaitingList(
                appointment.service._id,
                appointment.appointmentDate,
                appointment.startTime,
                appointment.endTime
            );
        }

        const messages = {
            confirmed: `Your appointment for ${appointment.service?.name} has been confirmed!`,
            completed: `Your appointment for ${appointment.service?.name} is marked as completed. Leave a review!`,
            cancelled: `Your appointment for ${appointment.service?.name} has been cancelled.`,
        };
        if (messages[status]) {
            await createNotification(appointment.customer._id, messages[status], 'appointment', '/appointments');
        }

        // Send email notification
        try {
            const customerEmail = appointment.customer?.email;
            const customerName = appointment.customer?.name;
            const serviceName = appointment.service?.name;
            const date = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            const time = `${appointment.startTime} – ${appointment.endTime}`;

            if (status === 'confirmed') {
                const _pad = (n) => String(n).padStart(2, '0');
                const _fmt = (d) => `${d.getFullYear()}${_pad(d.getMonth()+1)}${_pad(d.getDate())}T${_pad(d.getHours())}${_pad(d.getMinutes())}00`;
                const _base = new Date(appointment.appointmentDate);
                const [_sh, _sm] = (appointment.startTime || '09:00').split(':').map(Number);
                const [_eh, _em] = (appointment.endTime || '10:00').split(':').map(Number);
                const _gcalStart = new Date(_base.getFullYear(), _base.getMonth(), _base.getDate(), _sh, _sm);
                const _gcalEnd = new Date(_base.getFullYear(), _base.getMonth(), _base.getDate(), _eh, _em);
                const gcalUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(serviceName)}&dates=${_fmt(_gcalStart)}/${_fmt(_gcalEnd)}&details=${encodeURIComponent('Booked via Bookplus')}`;
                await sendAppointmentConfirmed(customerEmail, customerName, serviceName, date, time, gcalUrl);
            } else if (status === 'completed') {
                await sendAppointmentCompleted(customerEmail, customerName, serviceName);
                // Send rebooking prompt
                try {
                    const providerId = appointment.provider;
                    const providerDoc = providerId ? await require('../models/User').findById(providerId).select('name') : null;
                    await sendRebookingPrompt(customerEmail, customerName, serviceName, providerDoc?.name || 'your provider', providerId);
                } catch (_) { /* non-critical */ }
            } else if (status === 'cancelled') {
                await sendAppointmentCancelled(customerEmail, customerName, serviceName, date);
            }
        } catch (emailErr) {
            logger.error({ err: emailErr }, 'Email notification failed');
        }

        res.status(200).json({ success: true, data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.providerRescheduleAppointment = async (req, res) => {
    try {
        const { appointmentDate, startTime } = req.body;
        if (!appointmentDate || !startTime) {
            return res.status(400).json({ success: false, message: 'appointmentDate and startTime are required' });
        }
        const appointment = await Appointment.findById(req.params.id).populate('service');
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        if (appointment.provider.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        if (!['pending', 'confirmed'].includes(appointment.status)) {
            return res.status(400).json({ success: false, message: 'Cannot reschedule a cancelled or completed appointment' });
        }

        const duration = appointment.service?.duration || 30;
        const [hours, minutes] = startTime.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes + duration;
        const endHours = Math.floor(totalMinutes / 60) % 24;
        const endMins = totalMinutes % 60;
        const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;

        const providerId = appointment.provider;
        const schedule = await getProviderSchedule(providerId);
        if (!isTimeWithinSchedule(schedule, appointmentDate, startTime, duration)) {
            return res.status(400).json({ success: false, message: 'Selected time is outside your availability schedule' });
        }

        const conflict = await hasConflictingAppointment(providerId, appointmentDate, startTime, endTime, appointment._id);
        if (conflict) {
            return res.status(400).json({ success: false, message: 'This time slot is already booked' });
        }

        appointment.appointmentDate = new Date(appointmentDate);
        appointment.startTime = startTime;
        appointment.endTime = endTime;
        await appointment.save();
        res.status(200).json({ success: true, data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.rescheduleAppointment = async (req, res) => {
    try {
        const { appointmentDate, startTime } = req.body;
        if (!appointmentDate || !startTime) {
            return res.status(400).json({ success: false, message: 'appointmentDate and startTime are required' });
        }
        const appointment = await Appointment.findById(req.params.id)
            .populate('service')
            .populate('customer', 'name email');
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        if (appointment.customer._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        if (!['pending', 'confirmed'].includes(appointment.status)) {
            return res.status(400).json({ success: false, message: 'Only pending or confirmed appointments can be rescheduled' });
        }

        const duration = appointment.service?.duration || 30;
        const [hours, minutes] = startTime.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes + duration;
        const endHours = Math.floor(totalMinutes / 60) % 24;
        const endMins = totalMinutes % 60;
        const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;

        const providerId = appointment.provider || appointment.service?.provider;
        if (providerId) {
            const schedule = await getProviderSchedule(providerId);
            if (!isTimeWithinSchedule(schedule, appointmentDate, startTime, duration)) {
                return res.status(400).json({ success: false, message: 'Selected time is outside the provider availability schedule' });
            }
            const conflict = await hasConflictingAppointment(providerId, appointmentDate, startTime, endTime, appointment._id);
            if (conflict) {
                return res.status(400).json({ success: false, message: 'This time slot is already booked' });
            }
        }

        appointment.appointmentDate = new Date(appointmentDate);
        appointment.startTime = startTime;
        appointment.endTime = endTime;
        appointment.status = 'pending';
        await appointment.save();

        try {
            if (appointment.provider) {
                const provider = await User.findById(appointment.provider);
                if (provider) {
                    const date = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                    await sendAppointmentRescheduled(
                        provider.email,
                        provider.name,
                        appointment.customer.name,
                        appointment.service.name,
                        date,
                        startTime
                    );
                }
            }
        } catch (emailErr) {
            logger.error({ err: emailErr }, 'Reschedule email failed');
        }

        res.status(200).json({ success: true, data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};