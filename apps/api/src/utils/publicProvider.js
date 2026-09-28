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
 * A service whose provider account no longer exists at all (hard-deleted before
 * the admin delete cleaned up after itself) is never public either: callers
 * treat "no public provider row" as hidden, never as "global".
 */
const User = require('../models/User');

// Mongo condition that is TRUE for a suspended (or closed) account.
const SUSPENDED = { isActive: false, deactivatedAt: null };

/** A User filter for providers clients may see, merged with `extra`. */
const publicProviderFilter = (extra = {}) => ({ ...extra, role: 'provider', $nor: [SUSPENDED] });

/** Is this loaded provider doc visible to clients? (needs role, isActive, deactivatedAt) */
const isPublicProvider = (u) => !!u && u.role === 'provider' && !(u.isActive === false && !u.deactivatedAt);

/** Set of string ids (out of `ids`) that belong to public providers — one query. */
async function publicProviderIds(ids) {
    const list = [...new Set((ids || []).filter(Boolean).map(String))];
    if (!list.length) return new Set();
    const rows = await User.find(publicProviderFilter({ _id: { $in: list } })).select('_id').lean();
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

/**
 * null when new bookings may be made with this provider, otherwise the error
 * to send: { status, code, message }. Existing bookings are never touched.
 */
async function providerBookingBlock(providerId) {
    if (!providerId) return null; // a global (admin) service has no business behind it
    const u = await User.findById(providerId).select('role isActive deactivatedAt').lean();
    if (isPublicProvider(u)) return null;
    return { status: 403, code: 'provider_unavailable', message: UNAVAILABLE_MESSAGE };
}

module.exports = {
    SUSPENDED,
    publicProviderFilter,
    isPublicProvider,
    publicProviderIds,
    providerBookingBlock,
    teamBusinessSuspended,
    TEAM_SUSPENDED_MESSAGE,
    UNAVAILABLE_MESSAGE,
};
