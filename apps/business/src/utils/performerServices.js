/**
 * Who performs what — the owner's screens' mirror of the API's rules
 * (utils/staffBooking performsService + ownerPerforms, utils/memberPricing).
 *
 * The owner is a professional like any team member. What they perform is
 * Service.ownerPerforms (absent on old rows = yes); what a member performs is
 * their own list (or everything, when the owner put them on the whole menu).
 * Each books at their OWN price and time: the owner at the service's, a member
 * at their override when they have one.
 */

const idOf = (x) => String(x?._id || x);

/** Does the owner perform this service? Old rows with no answer: yes. */
export const ownerPerforms = (svc) => !!svc && svc.ownerPerforms !== false;

/** Does this team member perform this service? Same reading as the server. */
export const memberPerforms = (member, serviceId) => {
    if (!member) return false;
    if (member.offersAllServices === true) return true;
    const ids = (member.services || []).map(idOf);
    if (member.offersAllServices === false) return ids.includes(String(serviceId));
    return ids.length === 0 || ids.includes(String(serviceId));
};

/** The service as this member sells it: their price and minutes where they set one. */
export const asMember = (member, svc) => {
    const ov = (member?.serviceOverrides || []).find((o) => idOf(o.service) === String(svc._id));
    return {
        ...svc,
        price: ov && ov.price != null ? ov.price : svc.price,
        duration: ov && ov.duration != null ? ov.duration : svc.duration,
    };
};

/**
 * The services a professional can be booked for, at their prices.
 * `member` null = the owner. `all` = the owner's override to book anyone for
 * anything (still priced for that professional).
 */
export const servicesFor = (catalogue, member, { all = false } = {}) =>
    (catalogue || [])
        .filter((s) => s && s.isActive !== false)
        .filter((s) => all || (member ? memberPerforms(member, s._id) : ownerPerforms(s)))
        .map((s) => (member ? asMember(member, s) : s));

/** The active team members who perform this service (for "Only Erastus" chips). */
export const teamPerformers = (svc, members) =>
    (members || []).filter((m) => m.isActive !== false && m.bookable !== false && memberPerforms(m, svc._id));
