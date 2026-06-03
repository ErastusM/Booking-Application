const cron = require('node-cron');
const pino = require('pino');
const Appointment = require('../models/Appointment');
const { sendReminder24h, sendReminder1h } = require('./emailService');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

// Track consecutive cron failures so ops can be alerted
let consecutiveCronFailures = 0;
const MAX_FAILURES_BEFORE_ALERT = 3;

const startReminderJob = () => {
    // Run every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
        try {
            const now = new Date();

            // 24-hour window: appointmentDate between 23h and 25h from now
            const win24Low = new Date(now.getTime() + 23 * 60 * 60 * 1000);
            const win24High = new Date(now.getTime() + 25 * 60 * 60 * 1000);

            const appts24h = await Appointment.find({
                status: { $in: ['confirmed', 'pending'] },
                reminderSent24h: false,
                appointmentDate: { $gte: win24Low, $lte: win24High },
            }).populate('customer', 'name email').populate('service', 'name');

            for (const appt of appts24h) {
                if (!appt.customer?.email) continue;
                try {
                    const dateStr = new Date(appt.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                    await sendReminder24h(appt.customer.email, appt.customer.name, appt.service?.name || 'your appointment', dateStr, appt.startTime);
                    await Appointment.findByIdAndUpdate(appt._id, { reminderSent24h: true });
                } catch (e) {
                    log.error({ appointmentId: appt._id, err: e.message }, '24h reminder email failed');
                }
            }

            // 1-hour window: appointmentDate between 50min and 70min from now
            const win1Low = new Date(now.getTime() + 50 * 60 * 1000);
            const win1High = new Date(now.getTime() + 70 * 60 * 1000);

            const appts1h = await Appointment.find({
                status: { $in: ['confirmed', 'pending'] },
                reminderSent1h: false,
                appointmentDate: { $gte: win1Low, $lte: win1High },
            }).populate('customer', 'name email').populate('service', 'name');

            for (const appt of appts1h) {
                if (!appt.customer?.email) continue;
                try {
                    await sendReminder1h(appt.customer.email, appt.customer.name, appt.service?.name || 'your appointment', appt.startTime);
                    await Appointment.findByIdAndUpdate(appt._id, { reminderSent1h: true });
                } catch (e) {
                    log.error({ appointmentId: appt._id, err: e.message }, '1h reminder email failed');
                }
            }

            // Reset failure counter on success
            consecutiveCronFailures = 0;

        } catch (error) {
            consecutiveCronFailures += 1;
            log.error({ err: error.message, consecutiveCronFailures }, 'Reminder cron job failed');

            if (consecutiveCronFailures >= MAX_FAILURES_BEFORE_ALERT) {
                // Structured alert — surface to any log aggregation / alerting tool (Datadog, Sentry, etc.)
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
