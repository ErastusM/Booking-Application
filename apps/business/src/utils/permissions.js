/**
 * Frontend mirror of apps/api/src/utils/permissions.js — for UI VISIBILITY only.
 *
 * Real authorization is enforced server-side (every endpoint gates with can() /
 * allow()). This module lets the business app hide nav/tabs a staff member's tier
 * can't use, so they aren't shown doors that 403 on click. Keep the tier arrays
 * in sync with the backend; they change rarely and only in lockstep with it.
 *
 * can(user, cap): owners (role 'provider') and admins hold everything; other
 * non-staff hold nothing; a staff member holds their tier's set ∪ the Basic
 * self-baseline ∪ any capability granted by staffPermissions (the override
 * channel). Missing staffTier (null/undefined — nobody chose a level) ⇒ the
 * Service-provider default ('low'); only an explicit 'basic' is view-only.
 */
const BASIC = [
    'account:self', 'profile:self', 'calendar:view', 'availability:self', 'availability:view',
    'services:view', 'services:self', 'prices:self', 'timeoff:self', 'providers:view',
    'reviews:view', 'forms:submit', 'clients:contact:self',
    // Every staff member may see the clients they personally serve — and only
    // those. The whole-business client list is the owner's view alone; the
    // server (clientCRMController buildClientScope) narrows staff to their
    // assigned clients regardless of tier.
    'clients:assigned',
];
// Service provider: runs their own calendar — books walk-ins and the clients
// they serve into their own column, confirms/completes/cancels their own
// bookings, and blocks time in their OWN lane (calendar:block:self).
const LOW = BASIC.concat([
    'bookings:status:self', 'bookings:reschedule:self', 'bookings:cancel:self',
    'bookings:create', 'waitlist:manage', 'calendar:block:self',
]);
const MEDIUM = LOW.concat([
    'calendar:view_all', 'bookings:edit', 'bookings:status', 'bookings:reschedule',
    'bookings:cancel', 'calendar:manage', 'clients:view', 'clients:edit', 'clients:contact',
    'forms:manage',
]);
const HIGH = MEDIUM.concat([
    'reports:view', 'services:edit', 'prices:edit', 'packages:manage', 'availability:manage',
    'team:manage', 'wallet:view', 'settings:edit',
]);

export const TIERS = { basic: BASIC, low: LOW, medium: MEDIUM, high: HIGH };

/** The level a member holds when nobody chose one (mirrors DEFAULT_TIER in the API). */
export const DEFAULT_TIER = 'low';

/** The tier a user resolves to: no tier → DEFAULT_TIER; unknown → view-only. */
export const resolvedTier = (user) => {
    const t = user ? user.staffTier : null;
    if (t === null || t === undefined || t === '') return DEFAULT_TIER;
    return TIERS[t] ? t : 'basic';
};

/**
 * Owner-granted add-ons: switched on for ONE person and conferred by NO tier.
 * `clients:view_all` widens a staff member from their assigned clients to the
 * whole business's client list (front desk / manager). Kept out of the ladder on
 * purpose — folding it into High would hand over every client record just for
 * promoting someone. Mirrors GRANTABLE in apps/api/src/utils/permissions.js.
 */
export const GRANTABLE = ['clients:view_all'];

// Legacy flag → capability (mirrors the backend's LEGACY_CAP).
const LEGACY_CAP = { 'calendar:all': 'calendar:view_all' };
const CAP_SET = new Set([...HIGH, ...GRANTABLE]);
const canonical = (cap) => LEGACY_CAP[cap] || cap;

const flagCapabilities = (flags) =>
    (Array.isArray(flags) ? flags : [])
        .map((f) => LEGACY_CAP[f] || (CAP_SET.has(f) ? f : null))
        .filter(Boolean);

export const effectiveCapabilities = (user) => {
    const set = new Set(BASIC);
    TIERS[resolvedTier(user)].forEach((c) => set.add(c));
    flagCapabilities(user && user.staffPermissions).forEach((c) => set.add(c));
    return set;
};

export const can = (user, cap) => {
    if (!user) return false;
    if (user.role === 'provider' || user.role === 'admin') return true;
    if (user.role !== 'staff') return false;
    return effectiveCapabilities(user).has(canonical(cap));
};

// Convenience for React: does the (possibly null) user hold ANY of the caps?
export const canAny = (user, caps) => (Array.isArray(caps) ? caps : [caps]).some((c) => can(user, c));
