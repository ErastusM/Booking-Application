/**
 * Owner-side signal for turned-away bookings.
 *
 * Customers who hit "couldn't book" tell the owner about it rarely and late —
 * the phantom-slot incident surfaced via a WhatsApp screenshot days in. Every
 * refused CUSTOMER booking is recorded here; a burst (THRESHOLD within WINDOW)
 * raises one bell notification naming the dominant reason and linking straight
 * at the Working Hours tab, throttled so a bad day produces one alert, not a
 * flood. The same records feed the Overview "turned away this week" card.
 *
 * Recording is fire-and-forget: a rejection response must never fail or slow
 * down because the smoke detector hiccuped.
 */
const BookingRejection = require('../models/BookingRejection');
const Notification = require('../models/Notification');
const { createNotification } = require('./notificationhelper');

const WINDOW_MS = 60 * 60 * 1000;        // burst window: 1 hour
const THRESHOLD = 3;                     // rejections within the window → alert
const THROTTLE_MS = 6 * 60 * 60 * 1000;  // at most one alert per provider per 6h
// The alert links straight at the thing most bursts mean: hours config. The
// link doubles as the throttle marker (see maybeAlert).
const ALERT_LINK = '/dashboard?tab=availability';

const REASON_LABELS = {
    outside_hours: 'outside your working hours',
    off_shift: 'staff not rostered on',
    on_break: 'a staff break',
    time_off: 'staff on leave',
    booked: 'the staff member already booked',
    no_staff_available: 'no staff member available',
    not_bookable: 'the staff member not taking online bookings',
    staff_service_mismatch: 'the staff member not offering that service',
    unknown_member: 'the chosen staff member not being available',
    blocked: 'blocked time',
    slot_taken: 'the slot already being taken',
};
const labelFor = (reason) => REASON_LABELS[reason] || 'the time not being available';

const topReason = (docs) => {
    const counts = {};
    docs.forEach((d) => { counts[d.reason] = (counts[d.reason] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0] || null; // [reason, count] | null
};

async function maybeAlert(providerId) {
    const since = new Date(Date.now() - WINDOW_MS);
    const recent = await BookingRejection.find({ provider: providerId, createdAt: { $gte: since } })
        .select('reason').lean();
    if (recent.length < THRESHOLD) return;

    // One alert per throttle window: the previous alert itself is the marker.
    const throttled = await Notification.exists({
        user: providerId, type: 'system', link: ALERT_LINK,
        createdAt: { $gte: new Date(Date.now() - THROTTLE_MS) },
    });
    if (throttled) return;

    const [reason] = topReason(recent);
    await createNotification(
        providerId,
        `⚠️ ${recent.length} booking attempts were turned away in the last hour — most hit “${labelFor(reason)}”. Check your hours and staff setup.`,
        'system',
        ALERT_LINK
    );
}

/**
 * Record one refused customer booking and raise the alert if this makes a
 * burst. Fire-and-forget by design — call without awaiting.
 */
function recordBookingRejection({ providerId, reason, date, startTime }) {
    if (!providerId || !reason) return;
    const dayKey = typeof date === 'string' ? date.slice(0, 10) : (date ? new Date(date).toISOString().slice(0, 10) : '');
    BookingRejection.create({ provider: providerId, reason, date: dayKey, startTime: startTime || '' })
        .then(() => maybeAlert(providerId))
        .catch(() => { /* the smoke detector never breaks the request */ });
}

/** The Overview card's numbers: count + dominant reason over the TTL window (7 days). */
async function rejectionsSummary(providerId) {
    const docs = await BookingRejection.find({ provider: providerId }).select('reason').lean();
    const top = topReason(docs);
    return {
        count: docs.length,
        topLabel: top ? labelFor(top[0]) : null,
        topCount: top ? top[1] : 0,
        windowDays: 7,
    };
}

module.exports = { recordBookingRejection, rejectionsSummary, labelFor, REASON_LABELS };
