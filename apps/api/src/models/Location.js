const mongoose = require('mongoose');

/**
 * A physical place a business operates from — the first dimension of
 * multi-location support.
 *
 * STAGED, BACKWARD-COMPATIBLE ROLLOUT. Every existing business is single-
 * location today, and every existing query is location-blind. This model plus
 * the backfill (scripts/migrate_locations.js, one auto 'Main' location per
 * provider) is the FOUNDATION only: nothing reads `locationId` yet, so a
 * business with a single location behaves exactly as before. Later PRs thread
 * an optional `locationId` through availability / roster / booking / calendar
 * one dimension at a time, with `locationId` unset always meaning "the primary
 * location" — i.e. today's behaviour.
 *
 * `isPrimary` is the "resolves-to-when-unset" location: at most one per
 * provider, and the backfill guarantees exactly one exists for every provider.
 * `isActive:false` retires a location without deleting the row (bookings,
 * shifts and history may point at it), mirroring TeamMember.isActive.
 */
const locationSchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name:     { type: String, required: true, trim: true, maxlength: 120 },
    address:  { type: String, default: '', trim: true, maxlength: 300 },
    // The default location a null/unset locationId resolves to. Exactly one per
    // provider; setting one clears the others (see the controller).
    isPrimary: { type: Boolean, default: false },
    // Retire without deleting — history can still reference it. New bookings are
    // steered away from inactive locations once reads are threaded through.
    isActive:  { type: Boolean, default: true },
}, { timestamps: true });

// Reads are always provider-scoped, usually to "the active ones" or "the
// primary". Cheap compound index on the hot filter, matching TeamMember's
// pattern — and it already serves any provider-prefixed query, so no separate
// index on `provider` alone.
locationSchema.index({ provider: 1, isActive: 1 });

// HARD guarantee of the "at most one primary per provider" invariant that a
// null locationId relies on to resolve. A partial unique index means the DB
// itself rejects a second isPrimary:true for the same provider — so a
// first-create race or a bad write can never leave two primaries. (It does not
// force a primary to EXIST; the backfill + create-flow ensure that.)
locationSchema.index(
    { provider: 1 },
    { unique: true, partialFilterExpression: { isPrimary: true } }
);

module.exports = mongoose.model('Location', locationSchema);
