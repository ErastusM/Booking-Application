const Appointment = require('../models/Appointment');
const Service = require('../models/Service');
const { createNotification } = require('../utils/notificationHelper');

exports.getAllAppointments = async (req, res) => {
    try {
        let query = {};

        if (req.user.role === 'customer') {
            query = { customer: req.user._id };
        } else if (req.user.role === 'provider') {
            query = { provider: req.user._id };
        }

        const appointments = await Appointment.find(query)
            .populate('customer', 'name email phone')
            .populate('service', 'name price duration')
            .sort({ appointmentDate: -1 });

        res.status(200).json({ success: true, count: appointments.length, data: appointments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createAppointment = async (req, res) => {
    try {
        const { service, appointmentDate, startTime, endTime, notes } = req.body;

        if (!service || !appointmentDate || !startTime || !endTime) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        const svc = await Service.findById(service);
        if (!svc) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        const existingAppointment = await Appointment.findOne({
            service,
            appointmentDate: new Date(appointmentDate),
            startTime,
            status: { $nin: ['cancelled'] },
        });

        if (existingAppointment) {
            return res.status(400).json({ success: false, message: 'This time slot is already booked. You can join the waiting list instead.' });
        }
        const appointment = await Appointment.create({
            customer: req.user._id,
            service,
            provider: svc.provider || null,
            appointmentDate: new Date(appointmentDate),
            startTime,
            endTime,
            notes: notes || '',
            totalPrice: svc.price,
            status: 'pending',
        });

        await appointment.populate('service', 'name price duration');

        res.status(201).json({ success: true, message: 'Appointment created successfully', data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.cancelAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findById(req.params.id);

        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }

        if (appointment.customer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized to cancel this appointment' });
        }

        appointment.status = 'cancelled';
        appointment.cancellationReason = req.body.cancellationReason || '';
        await appointment.save();

        const { promoteFromWaitingList } = require('../utils/waitingListHelper');
        await promoteFromWaitingList(
            appointment.service,
            appointment.appointmentDate,
            appointment.startTime,
            appointment.endTime
        );

        res.status(200).json({ success: true, message: 'Appointment cancelled successfully', data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateAppointmentStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const appointment = await Appointment.findById(req.params.id)
            .populate('customer', 'name')
            .populate('service', 'name');

        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }

        if (
            req.user.role !== 'admin' &&
            appointment.provider?.toString() !== req.user._id.toString()
        ) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        appointment.status = status;
        await appointment.save();

        const messages = {
            confirmed: `Your appointment for ${appointment.service?.name} has been confirmed!`,
            completed: `Your appointment for ${appointment.service?.name} is marked as completed. Leave a review!`,
            cancelled: `Your appointment for ${appointment.service?.name} has been cancelled.`,
        };

        if (messages[status]) {
            await createNotification(
                appointment.customer._id,
                messages[status],
                'appointment',
                '/appointments'
            );
        }

        res.status(200).json({ success: true, data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};