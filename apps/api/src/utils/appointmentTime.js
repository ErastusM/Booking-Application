/**
 * Single source of truth for "when does a booking actually start, in real time".
 *
 * Bookplus operates in Namibia (Africa/Windhoek, UTC+2, no DST). `appointmentDate`
 * is stored at UTC-midnight of the booked day and `startTime` is the local
 * wall-clock "HH:MM", so the true instant in UTC is that calendar day at
 * (startTime − 2h). Computing in UTC keeps this independent of the server's own
 * timezone (the API container runs UTC).
 *
 * Historically only the reminder cron did this correctly; the past-slot and
 * cancellation-window checks interpreted startTime as server-local, making them
 * 2 hours off in production. Everything that needs the real start instant now
 * calls through here so the logic can never drift again.
 */
const NAMIBIA_OFFSET_MIN = 120;

/**
 * @param {Date|string} appointmentDate - stored UTC-midnight day
 * @param {string} startTime - "HH:MM" local (Africa/Windhoek) wall-clock
 * @returns {number} epoch ms of the real start instant, or NaN for a bad date
 */
const realStartMs = (appointmentDate, startTime) => {
    const d = new Date(appointmentDate);
    if (isNaN(d.getTime())) return NaN;
    const [h, m] = String(startTime || '00:00').split(':').map(Number);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h || 0, m || 0)
        - NAMIBIA_OFFSET_MIN * 60 * 1000;
};

module.exports = { realStartMs, NAMIBIA_OFFSET_MIN };
