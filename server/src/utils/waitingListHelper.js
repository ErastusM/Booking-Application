const WaitingList = require('../models/WaitingList');
const Appointment = require('../models/Appointment');
const Service = require('../models/Service');

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

        console.log(`Promoted ${next.customer.name} from waiting list`);
    } catch (error) {
        console.error('Waiting list promotion error:', error.message);
    }
};