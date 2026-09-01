/**
 * A team member's effective price/duration for a service.
 *
 * Each member inherits the business's Service price/duration unless they set an
 * override in TeamMember.serviceOverrides — that is what lets Erastus charge
 * N$170 and John N$200 for the same service without forking the catalogue.
 * A null field on the override means "inherit that value from the Service".
 *
 * These read only from stored data (the member's overrides and the Service), so
 * a client can never inject a price through the booking body.
 */

// The member's override row for a service, or null.
const overrideFor = (member, serviceId) => {
    if (!member || !Array.isArray(member.serviceOverrides) || !serviceId) return null;
    const sid = String(serviceId?._id || serviceId);
    return member.serviceOverrides.find(o => String(o.service?._id || o.service) === sid) || null;
};

// Effective price for (member, service): the override when set, else the Service.
const effectivePrice = (member, service) => {
    const ov = overrideFor(member, service?._id || service);
    if (ov && ov.price != null) return ov.price;
    return service?.price || 0;
};

// Effective duration (minutes) for (member, service).
const effectiveDuration = (member, service) => {
    const ov = overrideFor(member, service?._id || service);
    if (ov && ov.duration != null) return ov.duration;
    return service?.duration || 0;
};

module.exports = { overrideFor, effectivePrice, effectiveDuration };
