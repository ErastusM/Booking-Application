# -*- coding: utf-8 -*-
import io, os
p = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src', 'controllers', 'appointmentController.js'))
s = io.open(p, encoding='utf-8').read()
if 'exports.getAppointmentByToken' in s:
    print('already present'); raise SystemExit(0)

block = r'''

/* --- No-login "manage my booking" via opaque token --- */

exports.getAppointmentByToken = async (req, res) => {
    try {
        const appt = await Appointment.findOne({ manageToken: req.params.token })
            .populate('service', 'name price duration')
            .populate('provider', 'name businessProfile')
            .populate('teamMember', 'name');
        if (!appt) return res.status(404).json({ success: false, message: 'Booking not found' });
        // Only expose what a guest needs — never the full document
        res.status(200).json({
            success: true,
            data: {
                _id: appt._id,
                status: appt.status,
                appointmentDate: appt.appointmentDate,
                startTime: appt.startTime,
                endTime: appt.endTime,
                service: appt.service ? { name: appt.service.name, price: appt.service.price, duration: appt.service.duration } : null,
                provider: appt.provider ? { name: appt.provider.name, address: appt.provider.businessProfile?.address || '' } : null,
                staff: appt.teamMember ? appt.teamMember.name : null,
                clientName: appt.walkInName || null,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.cancelAppointmentByToken = async (req, res) => {
    try {
        const appt = await Appointment.findOne({ manageToken: req.params.token })
            .populate('service', 'name')
            .populate('customer', 'name email');
        if (!appt) return res.status(404).json({ success: false, message: 'Booking not found' });
        if (!['pending', 'confirmed'].includes(appt.status)) {
            return res.status(400).json({ success: false, message: 'This booking can no longer be cancelled.' });
        }
        appt.status = 'cancelled';
        appt.cancellationReason = 'Cancelled by client via link';
        appt.statusHistory.push({ status: 'cancelled', changedBy: appt.customer?._id || null });
        await appt.save();

        // Open the slot to the waiting list, like any other cancellation
        try {
            const { promoteFromWaitingList } = require('../utils/waitingListHelper');
            await promoteFromWaitingList(appt.service._id, appt.appointmentDate, appt.startTime, appt.endTime);
        } catch (err) { logger.error({ err }, 'Waitlist promotion after token-cancel failed'); }

        // Notify provider (fire-and-forget)
        setImmediate(async () => {
            try {
                if (appt.provider) {
                    const when = new Date(appt.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    await createNotification(appt.provider, `${appt.customer?.name || appt.walkInName || 'A client'} cancelled ${appt.service?.name} on ${when}.`, 'appointment', '/dashboard');
                }
            } catch (err) { logger.error({ err }, 'Cancel notification failed'); }
        });

        res.status(200).json({ success: true, message: 'Your booking has been cancelled.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
'''
s = s.rstrip() + '\n' + block
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('appended manage controllers')
