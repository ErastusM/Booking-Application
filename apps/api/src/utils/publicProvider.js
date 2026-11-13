/**
 * Which businesses clients may see and book — one rule for every public surface.
 *
 * An admin suspension (Admin → Users → Suspend) sets isActive:false on the
 * provider account. It used to only block the owner's sign-in: the business
 * stayed in the marketplace listing, search, its profile and booking link, and
 * clients could still book it. Every public read and every new booking now goes
 * through this rule, so a suspended business disappears everywhere at once and
 * comes back the moment it is reactivated (nothing else is changed or deleted).
 *
 * "Suspended" is exactly what the admin switch writes: isActive:false with no
 * deactivatedAt. A closed (self-deleted) account is also isActive:false with no
 * deactivatedAt, so it is hidden too. A business that paused its OWN account
 * (self-deactivation, deactivatedAt set) is left as before — that is the owner's
 * own, reversible choice and not what the admin switch controls.
 *
 * A business whose Bookplus plan is paused for non-payment (billingPausedAt,
 * set and cleared only by services/subscriptionRenewals.js and a director's
 * "keep free") stays listed and visible, but clients cannot make new online
 * bookings with it (providerBookingBlock, and its openings are left out of
 * search). The business itself keeps its dashboard and calendar, and can
 * still add bookings there; nothing is deleted.
 *
 * A service whose provider account no longer exists at all (hard-deleted before
 * the admin delete cleaned up after itself) is never public either: callers
 * treat "no public provider row" as hidden, never as "global".
 */
const User = require('../models/User');

// Mongo condition that is TRUE for a suspended (or closed) account.
const SUSPENDED = { isActive: false, deactivatedAt: null };

// Mongo condition that is TRUE for a business whose plan is paused for non-payment.
const PLAN_PAUSED = { billingPausedAt: { $type: 'date' } };

/** A User filter for providers clients may see, merged with `extra`. */
const publicProviderFilter = (extra = {}) => ({ ...extra, role: 'provider', $nor: [SUSPENDED] });

/** Is this loaded provider doc visible to clients? (needs role, isActive, deactivatedAt) */
const isPublicProvider = (u) => !!u && u.role === 'provider' && !(u.isActive === false && !u.deactivatedAt);

/** Can clients book this visible business online now? (needs billingPausedAt too) */
const isBookableOnline = (u) => isPublicProvider(u) && !u.billingPausedAt;

/** Set of string ids (out of `ids`) that belong to public providers — one query. */
async function publicProviderIds(ids) {
    const list = [...new Set((ids || []).filter(Boolean).map(String))];
    if (!list.length) return new Set();
    const rows = await User.find(publicProviderFilter({ _id: { $in: list } })).select('_id').lean();
    return new Set(rows.map((r) => String(r._id)));
}

/** The ids (out of `ids`) clients can book online now: public and not paused — one query. */
async function bookableProviderIds(ids) {
    const list = [...new Set((ids || []).filter(Boolean).map(String))];
    if (!list.length) return new Set();
    const rows = await User.find({ ...publicProviderFilter({ _id: { $in: list } }), $nor: [SUSPENDED, PLAN_PAUSED] }).select('_id').lean();
    return new Set(rows.map((r) => String(r._id)));
}

/**
 * A team member's login works only while their business does: when an admin
 * suspends the business, its team can't sign in either (and is let back in the
 * moment it is activated). true for a staff account whose business is suspended.
 */
async function teamBusinessSuspended(user) {
    if (!user || user.role !== 'staff' || !user.staffOf) return false;
    const biz = await User.findById(user.staffOf).select('isActive deactivatedAt').lean();
    return !!biz && biz.isActive === false && !biz.deactivatedAt;
}
const TEAM_SUSPENDED_MESSAGE = 'Your business’s Bookplus account has been suspended. Please contact the owner.';

const UNAVAILABLE_MESSAGE = 'This business isn’t taking bookings on Bookplus right now.';
const PAUSED_MESSAGE = 'This business isn’t taking online bookings right now. Please contact the business to book.';

/**
 * null when new bookings may be made with this provider, otherwise the error
 * to send: { status, code, message }. Existing bookings are never touched.
 * byBusiness: the business (owner or team) adding a booking to its own
 * calendar, which a paused plan does not stop.
 */
async function providerBookingBlock(providerId, { byBusiness = false } = {}) {
    if (!providerId) return null; // a global (admin) service has no business behind it
    const u = await User.findById(providerId).select('role isActive deactivatedAt billingPausedAt').lean();
    if (!isPublicProvider(u)) return { status: 403, code: 'provider_unavailable', message: UNAVAILABLE_MESSAGE };
    if (u.billingPausedAt && !byBusiness) return { status: 403, code: 'online_bookings_paused', message: PAUSED_MESSAGE };
    return null;
}

/** Is this user the business (its owner or a team member) behind providerId? */
const actsForBusiness = (user, providerId) => !!user && !!providerId && (
    (user.role === 'provider' && String(user._id) === String(providerId))
    || (user.role === 'staff' && String(user.staffOf) === String(providerId)));

module.exports = {
    SUSPENDED,
    PLAN_PAUSED,
    publicProviderFilter,
    isPublicProvider,
    isBookableOnline,
    publicProviderIds,
    bookableProviderIds,
    actsForBusiness,
    PAUSED_MESSAGE,
    providerBookingBlock,
    teamBusinessSuspended,
    TEAM_SUSPENDED_MESSAGE,
    UNAVAILABLE_MESSAGE,
};
