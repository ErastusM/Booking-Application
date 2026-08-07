const cron = require('node-cron');
const pino = require('pino');
const Appointment = require('../models/Appointment');
const Notification = require('../models/Notification');
const { sendReminder24h, sendReminder1h } = require('./emailService');
const { appointmentCalendar } = require('./calendarHelper');
const { primaryOrigin } = require('./origins');
const pushService = require('./pushService');
const { ApptPhrase } = require('./apptCopy');
const { withLock } = require('./lock');
const { realStartMs } = require('./appointmentTime');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

let consecutiveCronFailures = 0;
const MAX_FAILURES_BEFORE_ALERT = 3;

// The real appointment instant (Africa/Windhoek UTC+2) comes from the shared
// appointmentTime helper — the same source the past-slot and cancellation-window
// checks use, so reminder timing can never drift from those.
const apptStartMs = (appt) => realStartMs(appt.appointmentDate, appt.startTime);

const svcName = (appt) => appt.service?.name || 'your appointment';
// Customer-facing reminder label — "Your Taper Fade appointment" when we know the
// service, otherwise a plain "Your appointment".
const apptLabel = (appt) => ApptPhrase(appt.service?.name);
// Reminder recipient: the registered customer, or the guest who booked (no account).
const recipientEmail = (appt) => appt.customer?.email || appt.guestEmail || null;
const recipientName = (appt) => appt.customer?.name || appt.guestName || 'there';
const pushCustomer = (appt, body) => {
    if (!appt.customer?._id) return;
    // No-op unless VAPID is configured / the customer has subscribed.
    pushService.sendToUser(appt.customer._id, { title: 'Appointment reminder', body, url: '/appointments' }).catch(() => {});
};
// A persistent in-app reminder in the bell (separate from push so we never double-fire).
const notifyInApp = (appt, message) => {
    if (!appt.customer?._id) return;
    Notification.create({ user: appt.customer._id, message, type: 'appointment', link: '/appointments' }).catch(() => {});
};
// Google Calendar link + .ics + manage link to attach to a reminder email.
const calendarExtras = (appt) => {
    const { gcalUrl, ics } = appointmentCalendar(appt, { description: 'Booked via Bookplus', status: 'CONFIRMED' });
    // primaryOrigin(), NOT raw CLIENT_URL — CLIENT_URL is the comma-separated CORS
    // allowlist, and using it directly produced links like
    // "https://www.bookplus.pro,https://business.bookplus.pro/manage/<token>" that
    // Safari can't resolve. This matches how the booking/reschedule emails build it.
    const base = primaryOrigin();
    const manageUrl = appt.manageToken && base ? `${base}/manage/${appt.manageToken}` : undefined;
    return { gcalUrl, ics, manageUrl };
};

// Each rule fires once (guarded by its flag) when the appointment falls inside its
// minute window before the start. Windows are ≥ the 15-min cron interval so they
// are never skipped, and are tight enough not to overlap each other.
const RULES = [
    {
        flag: 'reminderSent24h', lo: 23 * 60, hi: 25 * 60,
        run: async (a) => {
            const dateStr = new Date(a.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            const email24 = recipientEmail(a);
            if (email24) {
                await sendReminder24h(email24, recipientName(a), svcName(a), dateStr, a.startTime, calendarExtras(a));
            }
            notifyInApp(a, `${apptLabel(a)} is tomorrow at ${a.startTime}.`);
            pushCustomer(a, `${apptLabel(a)} is tomorrow at ${a.startTime}.`);
        },
    },
    {
        flag: 'reminderSent5h', lo: 4 * 60 + 45, hi: 5 * 60 + 15,
        run: async (a) => { pushCustomer(a, `${apptLabel(a)} is in about 5 hours (${a.startTime}).`); },
    },
    {
        flag: 'reminderSent1h', lo: 45, hi: 75,
        run: async (a) => {
            const email1 = recipientEmail(a);
            if (email1) await sendReminder1h(email1, recipientName(a), svcName(a), a.startTime, calendarExtras(a));
            notifyInApp(a, `${apptLabel(a)} starts in about an hour (${a.startTime}).`);
            pushCustomer(a, `${apptLabel(a)} starts in about an hour (${a.startTime}).`);
        },
    },
];

const startReminderJob = () => {
    cron.schedule('*/15 * * * *', () => withLock('reminder-tick', 10 * 60 * 1000, async () => {
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
                const minsUntil = (apptStartMs(appt) - now) / 60000;
                for (const rule of RULES) {
                    if (minsUntil >= rule.lo && minsUntil <= rule.hi) {
                        // Claim the reminder atomically BEFORE sending, so it fires
                        // exactly once even if two ticks overlap (e.g. a lock lease
                        // that expired mid-run). Only the tick that flips the flag
                        // sends — this closes the double-send window independent of
                        // lock timing. (Sends are best-effort/swallowed, so claiming
                        // first won't lose a reminder to a transient throw.)
                        const claimed = await Appointment.updateOne(
                            { _id: appt._id, [rule.flag]: { $ne: true } },
                            { $set: { [rule.flag]: true } }
                        );
                        if (claimed.modifiedCount !== 1) continue; // already sent elsewhere
                        try {
                            await rule.run(appt);
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
    }));

    log.info('Reminder cron job started (every 15 minutes)');
};

module.exports = startReminderJob;
