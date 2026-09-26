/**
 * Who may do what — the owner and their team members.
 *
 * "I don't think we should have high or low members. Just members." There is
 * ONE kind of team member now. Every member holds the same set: they run their
 * OWN column — their own calendar, bookings, clients, blocked time, services,
 * prices, hours, time off, messages, waiting list and earnings. Nothing
 * business-wide: only the owner sees the whole business.
 *
 * The old access levels (User.staffTier) and per-member grants
 * (User.staffPermissions) are IGNORED. The fields stay in the schema so old
 * documents still load (and so one-off migrations can read history), but no
 * code path reads them for access and no endpoint writes them.
 *
 * The capability names are kept so every route and controller check reads the
 * same; they now resolve to "owner (and admin): yes", "member: only the
 * member set", "anyone else: no". Business-wide capabilities (calendar:view_all,
 * clients:view, bookings:status, team:manage, reports:view, wallet:view, …) are
 * still named where the code checks them — they are simply the owner's.
 *
 * Owners (role 'provider') and platform admins (role 'admin') are never gated:
 * can() returns true for them before any lookup.
 */

// What every team member may do — all of it about THEM.
const MEMBER = [
    'account:self', 'profile:self', 'calendar:view', 'availability:self', 'availability:view',
    'services:view', 'services:self', 'prices:self', 'timeoff:self', 'providers:view',
    'reviews:view', 'forms:submit', 'clients:contact:self',
    // The clients they personally serve (clientCRMController buildClientScope).
    'clients:assigned',
    // Their own bookings: confirm / complete / no-show / cancel / reschedule.
    'bookings:status:self', 'bookings:reschedule:self', 'bookings:cancel:self',
    // Book walk-ins and the clients they serve into their own column (single,
    // multi-service, group and repeat — appointmentController holds them to it).
    'bookings:create',
    // The waiting list for them (waitingListController scopes it to them).
    'waitlist:manage',
    // Block and unblock time in their OWN lane only (blockedTimeController).
    'calendar:block:self',
];
const MEMBER_SET = new Set(MEMBER);

// Legacy alias still accepted by callers.
const LEGACY_CAP = { 'calendar:all': 'calendar:view_all' };
const canonical = (cap) => LEGACY_CAP[cap] || cap;

/** A team member's capabilities: always the member set, whatever old fields hold. */
const effectiveCapabilities = () => new Set(MEMBER);

/**
 * can(user, capability) — the single authorization predicate. Owners/admins
 * pass unconditionally; a team member passes iff the capability is in the
 * member set; anyone else fails.
 */
const can = (user, cap) => {
    if (!user) return false;
    if (user.role === 'provider' || user.role === 'admin') return true;
    if (user.role !== 'staff') return false;
    return MEMBER_SET.has(canonical(cap));
};

module.exports = { MEMBER, can, effectiveCapabilities };
