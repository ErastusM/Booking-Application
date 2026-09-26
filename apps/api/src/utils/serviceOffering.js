/**
 * Who offers what, as clients see it.
 *
 * A business's catalogue (Service rows with provider = owner) is not the same
 * thing as what the OWNER offers. Team members add services they perform
 * themselves — a driver's "Long trip" on a barbershop's menu, at the driver's
 * own price — and those rows live in the same catalogue. Every public surface
 * used to read "the catalogue" as "the owner's menu", so the owner's tile, the
 * feed card's "Starting at", the profile and the service count all showed the
 * member's services at the member's prices, as if they were the owner's.
 *
 * The rules, in one place:
 *   - the owner offers a service when Service.ownerPerforms !== false
 *     (staffBooking.ownerPerforms), at the Service's own price and duration;
 *   - a team member offers it when performsService says so, at their own
 *     price/duration (memberPricing) — only active, bookable members count;
 *   - a service nobody offers is not bookable and is not shown to clients.
 */
const TeamMember = require('../models/TeamMember');
const { performsService, ownerPerforms } = require('./staffBooking');
const { effectivePrice, effectiveDuration } = require('./memberPricing');

// The members a client can actually be sent to.
const BOOKABLE_MEMBER = { isActive: true, bookable: { $ne: false } };

/** providerId(string) → bookable members (lean), primary member first. */
async function bookableMembersByProvider(providerIds) {
    const ids = (providerIds || []).filter(Boolean);
    const map = new Map();
    if (!ids.length) return map;
    const members = await TeamMember.find({ provider: { $in: ids }, ...BOOKABLE_MEMBER })
        .select('provider name services offersAllServices serviceOverrides isPrimary createdAt')
        .sort({ isPrimary: -1, createdAt: 1 })
        .lean();
    members.forEach((m) => {
        const k = String(m.provider);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(m);
    });
    return map;
}

/** Does anyone a client can book perform this service? */
const hasPerformer = (svc, members) =>
    ownerPerforms(svc) || (members || []).some((m) => performsService(m, svc._id));

/**
 * Everyone a client can book for this service, each at their OWN price:
 * the owner (when they offer it) at the Service's price, then each member at
 * their override (or the Service's value when they have none).
 */
const performersOf = (svc, members, ownerName) => {
    const out = [];
    if (ownerPerforms(svc)) {
        out.push({ _id: 'owner', name: ownerName || 'Owner', price: svc.price || 0, duration: svc.duration || 0 });
    }
    (members || []).forEach((m) => {
        if (!performsService(m, svc._id)) return;
        out.push({ _id: String(m._id), name: m.name, price: effectivePrice(m, svc), duration: effectiveDuration(m, svc) });
    });
    return out;
};

/**
 * The headline numbers a business shows clients (feed card, profile bar):
 * how many services, and the lowest/highest price.
 *
 * They describe the OWNER's own offering at the owner's prices — never a team
 * member's personal service or price. Only when the owner offers nothing
 * themselves (an owner who manages rather than performs) do they describe the
 * team's offering, each at the performer's own price, so the card isn't blank.
 */
function offeringSummary(services, members) {
    const bookable = (services || []).filter((s) => hasPerformer(s, members));
    const own = bookable.filter(ownerPerforms);
    let prices;
    let count;
    if (own.length) {
        prices = own.map((s) => s.price || 0);
        count = own.length;
    } else {
        prices = bookable.flatMap((s) => (members || [])
            .filter((m) => performsService(m, s._id))
            .map((m) => effectivePrice(m, s)));
        count = bookable.length;
    }
    return {
        bookable,
        ownServices: own,
        serviceCount: count,
        minPrice: prices.length ? Math.min(...prices) : null,
        maxPrice: prices.length ? Math.max(...prices) : null,
    };
}

module.exports = {
    BOOKABLE_MEMBER, bookableMembersByProvider, hasPerformer, performersOf, offeringSummary, ownerPerforms,
};
