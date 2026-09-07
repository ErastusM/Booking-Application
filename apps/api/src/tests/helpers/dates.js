/**
 * Relative test dates.
 *
 * The booking-create path rejects past slots (isPastSlot → realStartMs < now),
 * so any HARDCODED future calendar date in a create-path test silently turns the
 * test red the moment the wall clock passes it — and because CI's `test` job gates
 * build-and-push → deploy (and mongodb-memory-server can't run locally), that
 * freezes every deploy, hotfixes included. Anchor scheduling dates to a computed
 * future point instead, so they are always in the future at run time.
 *
 * The anchor is a Wednesday (the weekday of the retired 2026-09-16 literals) about
 * four weeks out, and is stable for the whole run — so intra-test date
 * relationships (ranges, "the day before", weekly repeats) are preserved by using
 * consistent offsets, and any weekday-sensitive setup still lines up.
 */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const ANCHOR = (() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + 28);                        // ~4 weeks out, clear of any grace window
    while (d.getDay() !== 3) d.setDate(d.getDate() + 1); // roll forward to a Wednesday
    return d;
})();

/** A date `offset` days from the anchor (offset may be negative), as 'YYYY-MM-DD'. */
const futureDate = (offset = 0) => {
    const d = new Date(ANCHOR);
    d.setDate(d.getDate() + offset);
    return ymd(d);
};

module.exports = { futureDate };
