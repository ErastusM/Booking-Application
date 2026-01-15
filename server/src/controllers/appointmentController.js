const Appointment = require('../models/Appointment');
const Service = require('../models/Service');

exports.getAllAppointments = async (req, res) => {
    try {
        const appointments = await Appointment.find()
            .populate('customer', 'name email phone')
            .populate('service', 'name price duration');

        res.status(200).json({
            success: true,
            count: appointments.length,
            data: appointments
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.getCustomerAppointments = async (req, res) => {
    try {
        const appointments = await Appointment.find({ customer: req.user.id })
            .populate('service', 'name price duration')
            .sort({ appointmentDate: -1 });

        res.status(200).json({
            success: true,
            count: appointments.length,
            data: appointments
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.createAppointment = async (req, res) => {
    try {
        const { serviceId, appointmentDate, startTime, endTime, notes } = req.body;

        if (!serviceId || !appointmentDate || !startTime || !endTime) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }

        const service = await Service.findById(serviceId);

        if (!service) {
            return res.status(404).json({
                success: false,
                message: 'Service not found'
            });
        }

        // Check for existing appointment at same time
        const existingAppointment = await Appointment.findOne({
            appointmentDate,
            startTime,
            status: { $ne: 'cancelled' }
        });

        if (existingAppointment) {
            return res.status(400).json({
                success: false,
                message: 'This time slot is already booked'
            });
        }

        const appointment = await Appointment.create({
            customer: req.user.id,
            service: serviceId,
            appointmentDate,
            startTime,
            endTime,
            notes: notes || '',
            totalPrice: service.price,
            status: 'pending'
        });

        await appointment.populate('service', 'name price duration');

        res.status(201).json({
            success: true,
            message: 'Appointment created successfully',
            data: appointment
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.updateAppointment = async (req, res) => {
    try {
        let appointment = await Appointment.findById(req.params.id);

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: 'Appointment not found'
            });
        }

        // Check authorization
        if (appointment.customer.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to update this appointment'
            });
        }

        const { appointmentDate, startTime, endTime, status, notes } = req.body;

        appointment.appointmentDate = appointmentDate || appointment.appointmentDate;
        appointment.startTime = startTime || appointment.startTime;
        appointment.endTime = endTime || appointment.endTime;
        appointment.status = status || appointment.status;
        appointment.notes = notes !== undefined ? notes : appointment.notes;

        await appointment.save();

        res.status(200).json({
            success: true,
            message: 'Appointment updated successfully',
            data: appointment
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.cancelAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findById(req.params.id);

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: 'Appointment not found'
            });
        }

        // Check authorization
        if (appointment.customer.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to cancel this appointment'
            });
        }

        const { cancellationReason } = req.body;

        appointment.status = 'cancelled';
        appointment.cancellationReason = cancellationReason || '';

        await appointment.save();

        res.status(200).json({
            success: true,
            message: 'Appointment cancelled successfully',
            data: appointment
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
