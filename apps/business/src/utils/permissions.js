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
 * channel). Missing staffTier ⇒ Basic baseline only.
 */
const BASIC = [
    'account:self', 'profile:self', 'calendar:view', 'availability:self', 'availability:view',
    'services:view', 'services:self', 'prices:self', 'timeoff:self', 'providers:view',
    'reviews:view', 'forms:submit', 'clients:contact:self',
];
const LOW = BASIC.concat([
    'bookings:status:self', 'bookings:reschedule:self', 'bookings:cancel:self',
    'bookings:create', 'waitlist:manage',
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

// Legacy flag → capability (mirrors the backend's LEGACY_CAP).
const LEGACY_CAP = { 'calendar:all': 'calendar:view_all' };
const CAP_SET = new Set(HIGH);
const canonical = (cap) => LEGACY_CAP[cap] || cap;

const flagCapabilities = (flags) =>
    (Array.isArray(flags) ? flags : [])
        .map((f) => LEGACY_CAP[f] || (CAP_SET.has(f) ? f : null))
        .filter(Boolean);

export const effectiveCapabilities = (user) => {
    const set = new Set(BASIC);
    if (user && TIERS[user.staffTier]) TIERS[user.staffTier].forEach((c) => set.add(c));
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
