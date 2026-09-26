/**
 * Frontend mirror of apps/api/src/utils/permissions.js — for UI VISIBILITY only.
 *
 * Real authorization is enforced server-side. There is one kind of team member:
 * every member holds the same set — their own calendar, bookings, clients,
 * blocked time, services, hours, time off, messages, waiting list and earnings.
 * Nothing business-wide; only the owner sees the whole business. The old access
 * levels (staffTier) and grants (staffPermissions) are ignored.
 *
 * can(user, cap): owners (role 'provider') and admins hold everything; a team
 * member holds the member set; anyone else holds nothing.
 */
export const MEMBER = [
    'account:self', 'profile:self', 'calendar:view', 'availability:self', 'availability:view',
    'services:view', 'services:self', 'prices:self', 'timeoff:self', 'providers:view',
    'reviews:view', 'forms:submit', 'clients:contact:self', 'clients:assigned',
    'bookings:status:self', 'bookings:reschedule:self', 'bookings:cancel:self',
    'bookings:create', 'waitlist:manage', 'calendar:block:self',
];
const MEMBER_SET = new Set(MEMBER);

// Legacy flag → capability (mirrors the backend).
const LEGACY_CAP = { 'calendar:all': 'calendar:view_all' };
const canonical = (cap) => LEGACY_CAP[cap] || cap;

export const effectiveCapabilities = () => new Set(MEMBER);

export const can = (user, cap) => {
    if (!user) return false;
    if (user.role === 'provider' || user.role === 'admin') return true;
    if (user.role !== 'staff') return false;
    return MEMBER_SET.has(canonical(cap));
};

// Convenience for React: does the (possibly null) user hold ANY of the caps?
export const canAny = (user, caps) => (Array.isArray(caps) ? caps : [caps]).some((c) => can(user, c));
