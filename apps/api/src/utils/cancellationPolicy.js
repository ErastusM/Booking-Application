/**
 * Cancellation-window enforcement. A provider's `bookingPolicy.
 * cancellationWindowHours` (default 24, 0 = anytime) is the minimum notice a
 * CUSTOMER must give to cancel or reschedule. Providers, staff and admins are
 * exempt — enforcement happens at the customer-facing call sites only.
 */
const User = require('../models/User');
const { realStartMs } = require('./appointmentTime');

// 0 = clients may cancel/reschedule at ANY time. Deliberately relaxed (owner
// request): the previous 24h default silently rejected late cancellations, so the
// booking stayed confirmed on the provider's calendar and the slot was never
// released to the waiting list — the business just saw a no-show. The machinery
// below is intact: a provider setting bookingPolicy.cancellationWindowHours > 0
// re-enables enforcement for their business.
const DEFAULT_WINDOW_HOURS = 0;

// Hours from now until the booking's real start. Uses the shared
// Africa/Windhoek-aware instant so the notice window matches the actual start
// (a plain setHours() read startTime as server-local/UTC → 2 hours off).
const hoursUntilStart = (appointmentDate, startTime) => {
    const t = realStartMs(appointmentDate, startTime);
    if (isNaN(t)) return Infinity; // bad date → let other validation reject
    return (t - Date.now()) / (60 * 60 * 1000);
};

/**
 * @returns {Promise<{allowed: boolean, windowHours: number, message?: string}>}
 */
async function checkCancellationWindow(providerId, appointmentDate, startTime) {
    let windowHours = DEFAULT_WINDOW_HOURS;
    if (providerId) {
        const provider = await User.findById(providerId).select('bookingPolicy');
        windowHours = provider?.bookingPolicy?.cancellationWindowHours ?? DEFAULT_WINDOW_HOURS;
    }
    if (windowHours <= 0) return { allowed: true, windowHours };
    if (hoursUntilStart(appointmentDate, startTime) >= windowHours) {
        return { allowed: true, windowHours };
    }
    return {
        allowed: false,
        windowHours,
        message: `This business requires at least ${windowHours} hour${windowHours === 1 ? '' : 's'} notice to cancel or reschedule. Please contact them directly.`,
    };
}

module.exports = { checkCancellationWindow, hoursUntilStart, DEFAULT_WINDOW_HOURS };
