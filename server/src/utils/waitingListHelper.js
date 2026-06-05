const WaitingList = require('../models/WaitingList');
const Appointment = require('../models/Appointment');
const Service = require('../models/Service');
const { createNotification } = require('./notificationhelper');

exports.promoteFromWaitingList = async (service, appointmentDate, startTime, endTime) => {
    try {
        const next = await WaitingList.findOne({
            service,
            appointmentDate,
            startTime,
            status: 'waiting',
            position: 1,
        }).populate('customer');

        if (!next) return;

        const svc = await Service.findById(service);

        await Appointment.create({
            customer: next.customer._id,
            service,
            appointmentDate,
            startTime,
            endTime,
            totalPrice: svc ? svc.price : 0,
            status: 'confirmed',
        });

        next.status = 'promoted';
        await createNotification(
            next.customer._id,
            `Good news! A slot opened up for ${svc?.name} on ${new Date(appointmentDate).toLocaleDateString()} at ${startTime}. You've been booked in!`,
            'waiting_list',
            '/appointments'
        );
        next.notified = true;
        await next.save();

        // Shift everyone else up — single bulkWrite instead of one save per entry
        const remaining = await WaitingList.find({
            service,
            appointmentDate,
            startTime,
            status: 'waiting',
        }).sort({ position: 1 });

        if (remaining.length > 0) {
            await WaitingList.bulkWrite(
                remaining.map((entry, i) => ({
                    updateOne: {
                        filter: { _id: entry._id },
                        update: { $set: { position: i + 1 } },
                    },
                }))
            );
        }

        console.log(`Promoted ${next.customer.name} from waiting list`);
    } catch (error) {
        console.error('Waiting list promotion error:', error.message);
    }
};