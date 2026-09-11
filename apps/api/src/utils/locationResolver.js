const mongoose = require('mongoose');
const Location = require('../models/Location');

/**
 * Validate a client-supplied booking location against a provider's own active
 * locations — the first step of threading the multi-location dimension through
 * the WRITE path.
 *
 * Contract (deliberately zero-overhead for single-location businesses):
 *   - No locationId supplied → { ok: true, locationId: null }. Null keeps today's
 *     behaviour (resolves to the provider's primary "Main"), and — crucially —
 *     adds NO database query to the booking hot path. Until a UI offers a picker,
 *     every booking takes this branch and nothing changes.
 *   - A locationId that is a real, ACTIVE location of THIS provider → stamped.
 *     The `provider` scope is the cross-tenant guard: a booking can never be
 *     pinned to another business's location.
 *   - Anything else (malformed id, unknown, another provider's, inactive) →
 *     { ok: false } so the caller can reject with a 400 rather than silently
 *     dropping or mis-stamping it.
 */
const resolveBookingLocation = async (providerId, requestedLocationId) => {
    if (requestedLocationId == null || requestedLocationId === '') {
        return { ok: true, locationId: null };
    }
    if (!mongoose.isValidObjectId(requestedLocationId)) {
        return { ok: false };
    }
    const loc = await Location.findOne({
        _id: requestedLocationId,
        provider: providerId,
        isActive: true,
    }).select('_id');
    if (!loc) return { ok: false };
    return { ok: true, locationId: loc._id };
};

module.exports = { resolveBookingLocation };
