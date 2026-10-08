/**
 * "A new booking was made" side-effects, in one place: the in-app/push alert to
 * whoever performs it (or the owner), their email, the client's notice when the
 * business booked for them, the admin feed, and the client's confirmation email
 * (with calendar links, manage link and directions).
 *
 * createAppointment fires these the moment a booking is made; an online-paid
 * booking fires the SAME ones once its payment is confirmed (it was only a
 * payment hold until then) — so the two can never drift apart.
 */
const pino = require('pino');
const User = require('../models/User');
const TeamMember = require('../models/TeamMember');
const notificationhelper = require('./notificationhelper');
const emailService = require('./emailService');
const calendarHelper = require('./calendarHelper');
const { servicePhrase } = require('./apptCopy');
const { primaryOrigin } = require('./origins');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Every distinct team member a booking should alert, resolved to their own login
// (+ email + name). A booking assigned to members who have their own logins pings
// EACH of them — so on a multi-service ticket every performer hears about it, not
// just the primary — and deep-links to their schedule. If no assigned member has
// a login (owner-column booking, or roster-only members), the alert falls back to
// the business owner's dashboard, exactly as before. The owner keeps whole-team
// oversight through the dashboard; this just re-points the actionable per-booking
// alert to the people it is about.
const bookingAlertTargets = async (providerId, teamMemberIds) => {
    const ids = [...new Set((teamMemberIds || []).filter(Boolean).map(String))];
    const targets = [];
    const seenUsers = new Set();
    for (const id of ids) {
        const m = await TeamMember.findById(id).select('user name email').populate('user', 'email name').lean();
        if (m && m.user) {
            // De-dupe by the LOGIN, not the roster row: two rows pointing at one
            // user (a data anomaly) must not double-notify that person.
            const uid = String(m.user._id);
            if (seenUsers.has(uid)) continue;
            seenUsers.add(uid);
            targets.push({
                userId: m.user._id,
                link: '/my-schedule',
                email: m.user.email || m.email || null,
                name: m.name || m.user.name || null,
            });
        }
    }
    if (targets.length) return targets;
    return [{ userId: providerId, link: '/dashboard', email: null, name: null }];
};

/**
 * @param {object} p
 * @param {object} p.appointment   the saved booking (needs _id, teamMember, manageToken)
 * @param {object} p.svc           its Service (name, provider)
 * @param {object} p.bookingClient { _id, name, email } — who the booking is for
 * @param {string} p.clientLabel   how the business sees the client ("Ana Shilongo", "a walk-in client")
 * @param {number} p.price         the booking's price (N$)
 * @param {string|Date} p.appointmentDate
 * @param {string} p.startTime
 * @param {string} p.endTime
 * @param {object} [p.bookedFor]   { clientUserId, bookerName } when the business booked for an existing client
 * @param {object} [p.extraEmail]  extra fields merged into the confirmation email's extras
 */
const announceNewBooking = async ({
    appointment, svc, bookingClient, clientLabel, price, appointmentDate, startTime, endTime, bookedFor = null, extraEmail = {},
}) => {
    try {
        const bookingDate = new Date(appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const priceTag = Number.isFinite(price) ? ` (N$${price.toFixed(2)})` : '';
        if (svc.provider) {
            const targets = await bookingAlertTargets(svc.provider, [appointment.teamMember]);
            const alertMsg = `New booking: ${clientLabel} booked ${servicePhrase(svc.name)}${priceTag} on ${bookingDate} at ${startTime}`;
            for (const t of targets) {
                await notificationhelper.createNotification(t.userId, alertMsg, 'appointment', t.link);
                // Member gets an email too (owner fallback has no email → in-app/push only, as before).
                // Guarded so a partial emailService mock in a test can't throw and skip the notices below.
                if (t.email && typeof emailService.sendStaffBookingAlert === 'function') {
                    emailService.sendStaffBookingAlert(t.email, t.name, svc.name, bookingDate, `${startTime} – ${endTime}`, clientLabel).catch(() => {});
                }
            }
        }
        // When a provider (or a staff member on their behalf) books an
        // existing client, let that client know.
        if (bookedFor && bookedFor.clientUserId) {
            await notificationhelper.createNotification(
                bookedFor.clientUserId,
                `You’re booked for ${servicePhrase(svc.name)} with ${bookedFor.bookerName} on ${bookingDate} at ${startTime}.`,
                'appointment',
                '/appointments'
            );
        }
        await notificationhelper.notifyAdmins(
            `New booking: ${servicePhrase(svc.name)} by ${clientLabel} on ${bookingDate} at ${startTime}`,
            'system',
            '/bkplus-command'
        );
    } catch (err) { logger.error({ err }, 'Booking notification failed'); }

    try {
        const dateStr = new Date(appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        const timeStr = `${startTime} – ${endTime}`;
        // Shared helper: emits a real UTC instant. The old inline builder wrote a
        // floating stamp with no zone, which Google reads as UTC — showing a 10:00
        // booking as 12:00 to a CAT (UTC+2) reader.
        const gcalUrl = calendarHelper.googleCalendarUrl({
            title: svc.name, appointmentDate, startTime, endTime,
            details: 'Booked via Bookplus',
        });

        // Extras for the confirmation email: venue, manage link, directions
        const providerDoc = svc.provider ? await User.findById(svc.provider).select('name businessProfile') : null;
        const address = providerDoc?.businessProfile?.address || '';
        const clientBase = primaryOrigin() || '';
        const extras = {
            price,
            currency: providerDoc?.businessProfile?.currency || 'NAD',
            bookingRef: String(appointment._id).slice(-8).toUpperCase(),
            manageUrl: appointment.manageToken ? `${clientBase}/manage/${appointment.manageToken}` : undefined,
            directionsUrl: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : undefined,
            venue: providerDoc?.name || undefined,
            address: address || undefined,
            // Downloadable .ics so the booking drops straight into any calendar app.
            ics: calendarHelper.buildIcs({
                uid: `${appointment._id}@bookplus`, title: svc.name,
                appointmentDate, startTime, endTime,
                description: 'Booked via Bookplus', location: address || undefined, status: 'CONFIRMED',
            }),
            ...extraEmail,
        };
        // Send the confirmation to whoever the booking is for: the registered
        // client when a provider booked on their behalf, otherwise the requester.
        // A walk-in has no account/email (staff walk-in) — nothing to send.
        if (bookingClient.email) {
            await emailService.sendAppointmentConfirmed(
                bookingClient.email,
                bookingClient.name,
                svc.name,
                dateStr,
                timeStr,
                gcalUrl,
                extras
            );
        }
    } catch (err) { logger.error({ err }, 'Booking confirmation email failed'); }
};

module.exports = { bookingAlertTargets, announceNewBooking };
