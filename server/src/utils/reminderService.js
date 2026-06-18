const cron = require('node-cron');
const pino = require('pino');
const Appointment = require('../models/Appointment');
const { sendReminder24h, sendReminder1h } = require('./emailService');
const pushService = require('./pushService');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

let consecutiveCronFailures = 0;
const MAX_FAILURES_BEFORE_ALERT = 3;

// Bookplus operates in Namibia (Africa/Windhoek, UTC+2, no DST). appointmentDate is
// stored at UTC-midnight of the booked day and startTime is the local wall-clock
// "HH:MM", so the real appointment instant in UTC is that date at (startTime − 2h).
// Computing in UTC keeps this independent of the server's own timezone.
const NAMIBIA_OFFSET_MIN = 120;
const realStartMs = (appt) => {
    const d = new Date(appt.appointmentDate);
    const [h, m] = String(appt.startTime || '00:00').split(':').map(Number);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h || 0, m || 0) - NAMIBIA_OFFSET_MIN * 60 * 1000;
};

const svcName = (appt) => appt.service?.name || 'your appointment';
const pushCustomer = (appt, body) => {
    if (!appt.customer?._id) return;
    // No-op unless VAPID is configured / the customer has subscribed.
    pushService.sendToUser(appt.customer._id, { title: 'Appointment reminder', body, url: '/appointments' }).catch(() => {});
};

// Each rule fires once (guarded by its flag) when the appointment falls inside its
// minute window before the start. Windows are ≥ the 15-min cron interval so they
// are never skipped, and are tight enough not to overlap each other.
const RULES = [
    {
        flag: 'reminderSent24h', lo: 23 * 60, hi: 25 * 60,
        run: async (a) => {
            if (a.customer?.email) {
                const dateStr = new Date(a.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                await sendReminder24h(a.customer.email, a.customer.name, svcName(a), dateStr, a.startTime);
            }
            pushCustomer(a, `${svcName(a)} is tomorrow at ${a.startTime}.`);
        },
    },
    {
        flag: 'reminderSent5h', lo: 4 * 60 + 45, hi: 5 * 60 + 15,
        run: async (a) => { pushCustomer(a, `${svcName(a)} is in about 5 hours, at ${a.startTime}.`); },
    },
    {
        flag: 'reminderSent1h', lo: 45, hi: 75,
        run: async (a) => {
            if (a.customer?.email) await sendReminder1h(a.customer.email, a.customer.name, svcName(a), a.startTime);
            pushCustomer(a, `${svcName(a)} is in 1 hour, at ${a.startTime}.`);
        },
    },
];

const startReminderJob = () => {
    cron.schedule('*/15 * * * *', async () => {
        try {
            const now = Date.now();
            // Candidate appointments: a generous date window so every reminder window is
            // covered regardless of start time; the per-appointment check below is precise.
            const appts = await Appointment.find({
                status: { $in: ['confirmed', 'pending'] },
                appointmentDate: { $gte: new Date(now - 24 * 60 * 60 * 1000), $lte: new Date(now + 48 * 60 * 60 * 1000) },
                $or: [{ reminderSent24h: false }, { reminderSent5h: false }, { reminderSent1h: false }],
            }).populate('customer', 'name email').populate('service', 'name');

            for (const appt of appts) {
                const minsUntil = (realStartMs(appt) - now) / 60000;
                for (const rule of RULES) {
                    if (!appt[rule.flag] && minsUntil >= rule.lo && minsUntil <= rule.hi) {
                        try {
                            await rule.run(appt);
                            await Appointment.findByIdAndUpdate(appt._id, { [rule.flag]: true });
                        } catch (e) {
                            log.error({ appointmentId: appt._id, rule: rule.flag, err: e.message }, 'reminder failed');
                        }
                    }
                }
            }

            consecutiveCronFailures = 0;
        } catch (error) {
            consecutiveCronFailures += 1;
            log.error({ err: error.message, consecutiveCronFailures }, 'Reminder cron job failed');
            if (consecutiveCronFailures >= MAX_FAILURES_BEFORE_ALERT) {
                log.fatal(
                    { consecutiveCronFailures, alert: 'CRON_REMINDER_DEGRADED' },
                    'ALERT: Reminder cron has failed multiple times in a row — manual intervention required'
                );
            }
        }
    });

    log.info('Reminder cron job started (every 15 minutes)');
};

module.exports = startReminderJob;
