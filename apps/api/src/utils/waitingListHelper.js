const { randomUUID } = require('crypto');
const WaitingList = require('../models/WaitingList');
const Appointment = require('../models/Appointment');
const Service = require('../models/Service');
const User = require('../models/User');
const { createNotification } = require('./notificationhelper');
const { servicePhrase } = require('./apptCopy');
const { overlapsBlockedTime } = require('./blockedTime');
const { googleCalendarUrl } = require('./calendarHelper');
const emailService = require('./emailService');
const pushService = require('./pushService');
const { primaryOrigin } = require('./origins');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// A 'promoting' claim older than this is treated as abandoned (the promoting
// process crashed mid-flight) and may be reclaimed, so a customer can't get
// stranded out of the waiting line. Comfortably longer than a promotion takes.
const PROMOTING_STALE_MS = 2 * 60 * 1000;

const toMinutes = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
};

// Is [startTime,endTime] free for this provider that day — no active appointment
// AND no blocked time? Promotion books on the customer's behalf, so it must
// respect a block just as a customer booking does; otherwise cancelling an
// appointment that sits inside a newly-blocked window would auto-book the next
// person in line straight into the provider's time off.
const slotIsFree = async (providerId, appointmentDate, startTime, endTime, teamMember = null) => {
    if (!providerId) return true;
    const dayStart = new Date(appointmentDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(appointmentDate); dayEnd.setHours(23, 59, 59, 999);
    const existing = await Appointment.find({
        provider: providerId,
        appointmentDate: { $gte: dayStart, $lte: dayEnd },
        status: { $nin: ['cancelled'] },
        // Per-staff: a colleague booked at the same clock time does NOT make this slot
        // occupied for the member this entry is for. Without the filter a multi-staff
        // business could never promote a waitlisted customer while any other staff
        // member was busy at that time (finding #16). null = the owner's own column.
        teamMember: teamMember || null,
    }).select('startTime endTime');
    const nStart = toMinutes(startTime);
    const nEnd = toMinutes(endTime || startTime);
    if (existing.some(a => nStart < toMinutes(a.endTime) && nEnd > toMinutes(a.startTime))) return false;
    // Pass teamMember so a block owned by ONE staff member doesn't suppress promotion
    // business-wide (the same staff-blindness applied to blocked time).
    return !(await overlapsBlockedTime({
        providerId, appointmentDate, startTime, endTime: endTime || startTime, teamMember: teamMember || null,
    }));
};

exports.promoteFromWaitingList = async (service, appointmentDate, startTime, endTime) => {
    try {
        // Atomically claim the next entry (waiting→promoting) BEFORE we book
        // anything, so two concurrent cancellations — or a retry of the same
        // cancel — can't promote the same person twice. One findOneAndUpdate does
        // both the select and the claim: whoever flips it first wins; a racing
        // caller sees promotingAt=now (not stale) and matches nothing.
        //
        // Self-healing: if a prior promotion died mid-flight (crash / rolling
        // restart) the entry is stuck in 'promoting'. A claim older than
        // PROMOTING_STALE_MS is treated as abandoned and reclaimable, so the
        // customer never silently falls out of the line.
        const staleBefore = new Date(Date.now() - PROMOTING_STALE_MS);
        const next = await WaitingList.findOneAndUpdate(
            {
                service,
                appointmentDate,
                startTime,
                position: 1,
                $or: [{ status: 'waiting' }, { status: 'promoting', promotingAt: { $lt: staleBefore } }],
            },
            { $set: { status: 'promoting', promotingAt: new Date() } },
            { new: true }
        ).populate('customer');

        if (!next) return; // nobody waiting, or another worker holds a fresh claim

        const svc = await Service.findById(service).select('name price duration provider');
        const providerId = next.provider || svc?.provider || null;

        // Only promote into a genuinely free slot — guards against a race where the
        // slot was re-taken between the cancellation and this promotion.
        if (!(await slotIsFree(providerId, appointmentDate, startTime, endTime, next.teamMember))) {
            // Release the claim so they keep their place in line.
            await WaitingList.updateOne({ _id: next._id, status: 'promoting' }, { $set: { status: 'waiting' } });
            logger.warn({ service: String(service), startTime }, 'Skipped waitlist promotion — slot no longer free');
            return;
        }

        const manageToken = randomUUID();
        let promoted;
        try {
            promoted = await Appointment.create({
                customer: next.customer._id,
                service,
                provider: providerId,
                // Promote onto the SAME staff column the waitlist entry targeted, so the
                // booking is visible to (and counted against) the right member instead of
                // silently landing on the owner's unassigned column (finding #16).
                teamMember: next.teamMember || null,
                appointmentDate,
                startTime,
                endTime,
                totalPrice: svc ? svc.price : 0,
                status: 'confirmed',
                statusHistory: [{ status: 'confirmed', changedBy: null }],
                manageToken,
            });
        } catch (createErr) {
            // Booking failed — release the claim so the slot can be retried.
            await WaitingList.updateOne({ _id: next._id, status: 'promoting' }, { $set: { status: 'waiting' } }).catch(() => {});
            throw createErr;
        }

        // Settle the claim to its final state.
        await WaitingList.updateOne({ _id: next._id }, { $set: { status: 'promoted', notified: true } });

        const dateStr = new Date(appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

        // In-app notification (bell) + a web push so they hear about it with the
        // app closed. The customer app also plays a full-screen celebratory moment
        // on next open (driven by the un-celebrated 'promoted' entry).
        const goodNews = `Good news! A slot opened up for ${servicePhrase(svc?.name)} on ${dateStr} at ${startTime}. You’ve been booked in!`;
        await createNotification(next.customer._id, goodNews, 'waiting_list', '/appointments');

        // Tell the BUSINESS too — a promotion writes a brand-new confirmed booking
        // onto their calendar. Without this it just appears out of nowhere, which
        // reads like a glitch right after they saw a cancellation.
        if (providerId) {
            await createNotification(
                providerId,
                `🔁 Slot refilled — ${next.customer.name} was booked from the waiting list for ${servicePhrase(svc?.name)} on ${dateStr} at ${startTime}.`,
                'appointment',
                '/dashboard'
            );
        }
        pushService.sendToUser(next.customer._id, {
            title: 'A slot opened up! 🎉',
            body: `You’re booked for ${servicePhrase(svc?.name)} on ${dateStr} at ${startTime}.`,
            url: '/appointments',
        }).catch(() => {});

        // Email the promoted customer their confirmation (fire-and-forget; safeSend never throws)
        if (next.customer.email) {
            const timeStr = `${startTime}${endTime ? ` – ${endTime}` : ''}`;
            // Shared helper (real UTC instant). The old inline builder wrote a floating
            // stamp with no zone, which Google reads as UTC — advertising a 10:00 slot
            // as 12:00 to a CAT (UTC+2) reader.
            const gcalUrl = googleCalendarUrl({
                title: svc?.name || 'Appointment',
                appointmentDate, startTime, endTime: endTime || startTime,
                details: 'Booked via Bookplus',
            });

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
