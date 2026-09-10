/**
 * Staff permissions — capabilities & tiers.
 *
 * `User.staffPermissions` predates enforcement; today exactly one flag is
 * enforced (calendar:all, read in buildAppointmentScope). This module widens
 * that into a capability vocabulary and preset TIERS, WITHOUT changing anyone's
 * current access — legacy flags map onto capabilities so an existing roster
 * behaves byte-for-byte as before.
 *
 * Rules that keep it honest:
 *   1. A capability is only meaningful once something actually checks it. The
 *      vocabulary is defined here; routes adopt requireCapability() incrementally
 *      (see middleware/auth.js). Until a route is switched, its capability grants
 *      nothing — default staffTier=null grants only the self-baseline.
 *   2. Owners (role 'provider') and platform admins (role 'admin') are never
 *      tier-gated. can() short-circuits to true for them BEFORE any lookup — a
 *      permission system that could lock an owner out of their own business would
 *      be a bug generator, not a safeguard.
 */

/** Legacy flag — see every team member's bookings, not just your own. */
const CALENDAR_ALL = 'calendar:all';

// Legacy enforced flags. Kept exported for back-compat; superseded by capabilities.
const KNOWN = [CALENDAR_ALL];

/**
 * Legacy flags the invite flow wrote that were descriptive rather than enforced.
 * `calendar:self` is the ABSENCE of calendar:all; `clients:assigned` never
 * branched anything. They map to no capability — the self-baseline every staff
 * member already holds — but stay accepted so old rosters and re-invites validate.
 */
const DESCRIPTIVE = ['calendar:self', 'clients:assigned'];

// ── Capability vocabulary ──────────────────────────────────────────────────
// Grouped by the tier that first grants them. Higher tiers are cumulative.

// Basic — the self-baseline every authenticated staff member holds. These are
// enforced by controller self-scoping (buildAppointmentScope own branch,
// myMemberDoc, canTouchStaffAvailability, message isParty), never by a tier gate.
const BASIC = [
    'account:self', 'profile:self', 'calendar:view', 'availability:self', 'availability:view',
    'services:view', 'services:self', 'prices:self', 'timeoff:self', 'providers:view',
    'reviews:view', 'forms:submit', 'clients:contact:self',
];

// Low — a service provider running their OWN book.
const LOW = BASIC.concat([
    'bookings:status:self', 'bookings:reschedule:self', 'bookings:cancel:self',
    'bookings:create', 'waitlist:manage',
]);

// Medium — reception / front desk: the whole-business calendar + client book.
const MEDIUM = LOW.concat([
    'calendar:view_all', 'bookings:edit', 'bookings:status', 'bookings:reschedule',
    'bookings:cancel', 'calendar:manage', 'clients:view', 'clients:edit', 'clients:contact',
    'forms:manage',
]);

// High — management: reports, catalogue/pricing, packages, and team admin.
const HIGH = MEDIUM.concat([
    'reports:view', 'services:edit', 'prices:edit', 'packages:manage', 'availability:manage',
    'team:manage', 'wallet:view', 'settings:edit',
]);

// Preset tiers a staff member can be assigned. Owner/admin are NOT tiers — they
// hold everything implicitly via the can() role short-circuit.
const TIERS = {
    basic: BASIC,
    low: LOW,
    medium: MEDIUM,
    high: HIGH,
};
const TIER_NAMES = Object.keys(TIERS);

// Every staff-assignable capability (High is cumulative, so it is the full set).
const CAPABILITIES = [...new Set(HIGH)];

// Legacy flag → capability. calendar:all becomes calendar:view_all; the
// descriptive flags map to nothing (they only ever meant the self-baseline).
const LEGACY_CAP = { 'calendar:all': 'calendar:view_all' };

// Resolve a requested key to its canonical capability (honour the legacy alias).
const canonical = (cap) => LEGACY_CAP[cap] || cap;

// Capabilities a member's legacy staffPermissions still grant.
const legacyCapabilities = (flags) =>
    (Array.isArray(flags) ? flags : []).map((f) => LEGACY_CAP[f]).filter(Boolean);

/**
 * A staff member's EFFECTIVE capabilities: the Basic self-baseline everyone
 * holds, plus their assigned tier's set, plus anything their legacy flags still
 * grant. A member with staffTier=null and only legacy flags resolves to exactly
 * today's behaviour.
 */
const effectiveCapabilities = (user) => {
    const set = new Set(BASIC);
    if (user && TIERS[user.staffTier]) TIERS[user.staffTier].forEach((c) => set.add(c));
    legacyCapabilities(user && user.staffPermissions).forEach((c) => set.add(c));
    return set;
};

/**
 * can(user, capability) — the single authorization predicate.
 * Accepts a capability key OR a legacy flag (canonicalised). Owners/admins pass
 * unconditionally; other non-staff fail; staff pass iff the capability is in
 * their effective set.
 */
const can = (user, cap) => {
    if (!user) return false;
    if (user.role === 'provider' || user.role === 'admin') return true;
    if (user.role !== 'staff') return false;
    return effectiveCapabilities(user).has(canonical(cap));
};

/** Split a requested flag/capability list into accepted and rejected. */
const validate = (flags) => {
    const list = Array.isArray(flags) ? flags.map(String) : [];
    const allowed = new Set([...KNOWN, ...DESCRIPTIVE, ...CAPABILITIES]);
    return {
        accepted: list.filter((f) => allowed.has(f)),
        rejected: list.filter((f) => !allowed.has(f)),
    };
};

/** Is `t` a known preset tier name? */
const isTier = (t) => TIER_NAMES.includes(t);

module.exports = {
    CALENDAR_ALL, KNOWN, DESCRIPTIVE,
    CAPABILITIES, TIERS, TIER_NAMES,
    can, validate, isTier, effectiveCapabilities,
};
