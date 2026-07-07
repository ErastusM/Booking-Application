/**
 * Cancellation-window enforcement. A provider's `bookingPolicy.
 * cancellationWindowHours` (default 24, 0 = anytime) is the minimum notice a
 * CUSTOMER must give to cancel or reschedule. Providers, staff and admins are
 * exempt — enforcement happens at the customer-facing call sites only.
 */
const User = require('../models/User');

const DEFAULT_WINDOW_HOURS = 24;

const hoursUntilStart = (appointmentDate, startTime) => {
    const dt = new Date(appointmentDate);
    if (isNaN(dt.getTime())) return Infinity; // bad date → let other validation reject
    const [h, m] = String(startTime).split(':').map(Number);
    dt.setHours(h || 0, m || 0, 0, 0);
    return (dt.getTime() - Date.now()) / (60 * 60 * 1000);
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
