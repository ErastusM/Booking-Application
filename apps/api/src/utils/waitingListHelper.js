const { randomUUID } = require('crypto');
const WaitingList = require('../models/WaitingList');
const Appointment = require('../models/Appointment');
const Service = require('../models/Service');
const User = require('../models/User');
const { createNotification } = require('./notificationhelper');
const emailService = require('./emailService');
const { primaryOrigin } = require('./origins');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const toMinutes = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
};

// Is [startTime,endTime] free of any active appointment for this provider that day?
const slotIsFree = async (providerId, appointmentDate, startTime, endTime) => {
    if (!providerId) return true;
    const dayStart = new Date(appointmentDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(appointmentDate); dayEnd.setHours(23, 59, 59, 999);
    const existing = await Appointment.find({
        provider: providerId,
        appointmentDate: { $gte: dayStart, $lte: dayEnd },
        status: { $nin: ['cancelled'] },
    }).select('startTime endTime');
    const nStart = toMinutes(startTime);
    const nEnd = toMinutes(endTime || startTime);
    return !existing.some(a => nStart < toMinutes(a.endTime) && nEnd > toMinutes(a.startTime));
};

exports.promoteFromWaitingList = async (service, appointmentDate, startTime, endTime) => {
    try {
        const next = await WaitingList.findOne({
            service,
            appointmentDate,
            startTime,
            status: 'waiting',
            position: 1,
        }).populate('customer');

        if (!next) return; // Nobody waiting

        const svc = await Service.findById(service).select('name price duration provider');
        const providerId = next.provider || svc?.provider || null;

        // Only promote into a genuinely free slot — guards against a race where the
        // slot was re-taken between the cancellation and this promotion.
        if (!(await slotIsFree(providerId, appointmentDate, startTime, endTime))) {
            logger.warn({ service: String(service), startTime }, 'Skipped waitlist promotion — slot no longer free');
            return;
        }

        const manageToken = randomUUID();
        const promoted = await Appointment.create({
            customer: next.customer._id,
            service,
            provider: providerId,
            appointmentDate,
            startTime,
            endTime,
            totalPrice: svc ? svc.price : 0,
            status: 'confirmed',
            statusHistory: [{ status: 'confirmed', changedBy: null }],
            manageToken,
        });

        next.status = 'promoted';
        next.notified = true;
        await next.save();

        const dateStr = new Date(appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

        // In-app notification
        await createNotification(
            next.customer._id,
            `Good news! A slot opened up for ${svc?.name || 'your service'} on ${dateStr} at ${startTime}. You've been booked in!`,
            'waiting_list',
            '/appointments'
        );

        // Email the promoted customer their confirmation (fire-and-forget; safeSend never throws)
        if (next.customer.email) {
            const timeStr = `${startTime}${endTime ? ` – ${endTime}` : ''}`;
            const _pad = (n) => String(n).padStart(2, '0');
            const _fmt = (d) => `${d.getFullYear()}${_pad(d.getMonth() + 1)}${_pad(d.getDate())}T${_pad(d.getHours())}${_pad(d.getMinutes())}00`;
            const _base = new Date(appointmentDate);
            const [_sh, _sm] = String(startTime).split(':').map(Number);
            const [_eh, _em] = String(endTime || startTime).split(':').map(Number);
            const gcalStart = new Date(_base.getFullYear(), _base.getMonth(), _base.getDate(), _sh, _sm);
            const gcalEnd = new Date(_base.getFullYear(), _base.getMonth(), _base.getDate(), _eh, _em);
            const gcalUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(svc?.name || 'Appointment')}&dates=${_fmt(gcalStart)}/${_fmt(gcalEnd)}&details=${encodeURIComponent('Booked via Bookplus')}`;

            const providerDoc = providerId ? await User.findById(providerId).select('name businessProfile') : null;
            const address = providerDoc?.businessProfile?.address || '';
            // primaryOrigin(), NOT raw CLIENT_URL (comma-separated CORS allowlist),
            // or the manage link becomes a malformed "url1,url2/manage/..." Safari
            // can't open — matches how confirmation/reminder emails build it.
            const clientBase = primaryOrigin();
            const extras = {
                price: svc ? svc.price : undefined,
                bookingRef: String(promoted._id).slice(-8).toUpperCase(),
                manageUrl: clientBase ? `${clientBase}/manage/${manageToken}` : undefined,
                directionsUrl: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : undefined,
                venue: providerDoc?.name || undefined,
                address: address || undefined,
            };
            emailService
                .sendAppointmentConfirmed(next.customer.email, next.customer.name, svc?.name || 'your appointment', dateStr, timeStr, gcalUrl, extras)
                .catch(err => logger.error({ err }, 'Waitlist promotion email failed'));
        }

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

        logger.info({ customer: next.customer.name, appointmentId: String(promoted._id) }, 'Promoted from waiting list');
    } catch (error) {
        logger.error({ err: error }, 'Waiting list promotion error');
    }
};
