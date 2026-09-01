/**
 * Blocked-time enforcement, shared by the slot list and the booking/reschedule paths.
 *
 * Blocked time used to be consulted in exactly one place — the per-staff resolver
 * (staffBooking.js) — which returns early for zero-staff businesses. That left a
 * hole: a solo provider's blocked slots were invisible to the customer slot list
 * AND unchecked when the booking was saved, so a customer could book straight
 * over the provider's lunch break or day off.
 *
 * Recurring blocks are already materialised as one document per occurrence
 * (blockedTimeController.generateOccurrences), so an exact-date lookup finds
 * them — no recurrence expansion is needed here.
 */
const BlockedTime = require('../models/BlockedTime');

const toMinutes = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};

// BlockedTime.date is a plain 'YYYY-MM-DD' string, and requests carry the same
// string. A Date is normalised exactly the way staffBooking.js does it, so both
// code paths always agree on which calendar day a booking falls on.
const toDateKey = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));

// Business-wide blocks (teamMember null, !ownerOnly) always apply. A member's
// own block applies only to bookings on that member; an owner-only block
// (teamMember null, ownerOnly) applies only to the owner's own bookings — the
// ones with no teamMember. Otherwise a single person's block would close the
// whole business.
//   - booking on a member  → business-wide + that member (NOT owner-only)
//   - booking on the owner → every teamMember:null block (business-wide + owner-only)
const scopeFilter = (teamMember) => (teamMember
    ? [{ teamMember: null, ownerOnly: { $ne: true } }, { teamMember }]
    : [{ teamMember: null }]);

/** Every block covering `appointmentDate` that applies to this booking's scope. */
const findBlocksForDate = (providerId, appointmentDate, teamMember = null) =>
    BlockedTime.find({
        provider: providerId,
        date: toDateKey(appointmentDate),
        $or: scopeFilter(teamMember),
    }).select('startTime endTime reason -_id').lean();

/**
 * Blocks covering ANY of these date keys — one query for a whole recurring
 * series, so validating 60 occurrences doesn't mean 60 round trips.
 * Keeps `date` so callers can bucket the results per occurrence.
 */
const findBlocksForDates = (providerId, dateKeys, teamMember = null) =>
    BlockedTime.find({
        provider: providerId,
        date: { $in: dateKeys },
        $or: scopeFilter(teamMember),
    }).select('date startTime endTime -_id').lean();

/**
 * True when [startTime, endTime) overlaps any applicable block.
 * Half-open comparison, so a booking that ends exactly when a block starts
 * (or starts exactly when one ends) is allowed — same predicate the
 * appointment-conflict checks use.
 */
async function overlapsBlockedTime({ providerId, appointmentDate, startTime, endTime, teamMember = null }) {
    if (!providerId) return false;
    const blocks = await findBlocksForDate(providerId, appointmentDate, teamMember);
    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    return blocks.some(b => start < toMinutes(b.endTime) && end > toMinutes(b.startTime));
}

// Shown to a customer who picked a slot the provider has blocked. Deliberately
// vague about WHY — a client doesn't need to see "dentist appointment".
const BLOCKED_MESSAGE = 'That time is not available. Please choose another slot.';

module.exports = {
    overlapsBlockedTime, findBlocksForDate, findBlocksForDates,
    toMinutes, toDateKey, BLOCKED_MESSAGE,
};
