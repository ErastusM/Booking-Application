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
 *      nothing. A member nobody chose a level for (staffTier null/undefined)
 *      resolves to DEFAULT_TIER ('low', "Service provider") — they run their own
 *      calendar from day one. Only an EXPLICIT 'basic' is view-only.
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
 * Legacy flags the invite flow wrote that are descriptive rather than enforced.
 * `calendar:self` is the ABSENCE of calendar:view_all, so it maps to no
 * capability — the self-baseline every staff member already holds — but stays
 * accepted so old rosters and re-invites validate.
 *
 * `clients:assigned` USED to sit here as a no-op, which is why a staff member
 * saw either nothing or (on Medium) the whole business's client list. The spec
 * always called for assigned-only (DUAL_APP_SPEC §2b "/clients … staff(assigned)",
 * §4.2 "for calendar/clients, to their own assignments", Epic 2.4 AC), so it is
 * now a REAL capability in BASIC — see below.
 */
const DESCRIPTIVE = ['calendar:self'];

// ── Capability vocabulary ──────────────────────────────────────────────────
// Grouped by the tier that first grants them. Higher tiers are cumulative.

// Basic — the self-baseline every authenticated staff member holds. These are
// enforced by controller self-scoping (buildAppointmentScope own branch,
// myMemberDoc, canTouchStaffAvailability, message isParty), never by a tier gate.
const BASIC = [
    'account:self', 'profile:self', 'calendar:view', 'availability:self', 'availability:view',
    'services:view', 'services:self', 'prices:self', 'timeoff:self', 'providers:view',
    'reviews:view', 'forms:submit', 'clients:contact:self',
    // Every staff member may see the clients they personally serve — and ONLY
    // those. Seeing the whole business's client list is the owner's view alone;
    // no tier or flag widens a staff principal to it (clientCRMController's
    // buildClientScope enforces this). Being in BASIC means an invited staff
    // member holds it from day one, which is what the Epic 2.4 AC requires.
    'clients:assigned',
];

// Low — "Service provider": a member running their OWN calendar. They book
// walk-ins and the clients they personally serve into their own column
// (appointmentController isStaffWalkIn / isStaffSelfOnBehalf), confirm /
// complete / cancel / reschedule their own bookings, and block time in their
// OWN lane only (`calendar:block:self` — blockedTimeController refuses
// business-wide, owner-only and colleagues' blocks). Whole-business blocking is
// `calendar:manage` (Medium+).
const LOW = BASIC.concat([
    'bookings:status:self', 'bookings:reschedule:self', 'bookings:cancel:self',
    'bookings:create', 'waitlist:manage', 'calendar:block:self',
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

/**
 * The level a staff member holds when nobody chose one (staffTier null or
 * undefined): "Service provider". A freshly invited member must be able to book
 * their own clients and block their own time; view-only is an explicit owner
 * choice ('basic'), never the accidental default.
 */
const DEFAULT_TIER = 'low';

/**
 * The tier a user actually resolves to: no tier chosen → DEFAULT_TIER; a known
 * tier → itself; anything else (a value the schema enum should never admit)
 * fails closed to the view-only baseline.
 */
const resolvedTier = (user) => {
    const t = user ? user.staffTier : null;
    if (t === null || t === undefined || t === '') return DEFAULT_TIER;
    return TIERS[t] ? t : 'basic';
};

/**
 * OWNER-GRANTED add-ons: capabilities an owner switches on for ONE named person
 * and that NO tier ever confers.
 *
 * `clients:view_all` widens a staff member from their ASSIGNED clients to the
 * whole business's client list — the front-desk / manager case. That list is
 * otherwise the owner's view alone (buildClientScope), so this deliberately sits
 * OUTSIDE the tier ladder: folding it into High would make "promote someone to
 * High" silently hand over every client record, which is exactly the leak the
 * assigned-client scoping closed. It is grantable only as an explicit
 * per-member staffPermissions entry, so granting it is always a deliberate act
 * against one person.
 */
const GRANTABLE = ['clients:view_all'];

// Everything a staffPermissions entry may name: the tier ladder plus the
// owner-granted add-ons (which no tier includes).
const CAPABILITIES = [...new Set([...HIGH, ...GRANTABLE])];

// Legacy flag → capability. calendar:all becomes calendar:view_all; the
// descriptive flags map to nothing (they only ever meant the self-baseline).
const LEGACY_CAP = { 'calendar:all': 'calendar:view_all' };

const CAP_SET = new Set(CAPABILITIES); // every staff-assignable capability (tiers + add-ons)

// Resolve a requested key to its canonical capability (honour the legacy alias).
const canonical = (cap) => LEGACY_CAP[cap] || cap;

// Capabilities a member's staffPermissions grant: legacy flags via LEGACY_CAP,
// AND any entry that is already a capability key (validate() only ever stores
// KNOWN ∪ DESCRIPTIVE ∪ CAPABILITIES, so this makes staffPermissions a real
// per-member OVERRIDE channel layered on top of the tier). The remaining
// descriptive flag (calendar:self) maps to nothing — the self-baseline.
const flagCapabilities = (flags) =>
    (Array.isArray(flags) ? flags : [])
        .map((f) => LEGACY_CAP[f] || (CAP_SET.has(f) ? f : null))
        .filter(Boolean);

/**
 * A staff member's EFFECTIVE capabilities: the Basic self-baseline everyone
 * holds, plus their tier's set, plus anything their staffPermissions grant
 * (legacy flags and owner-granted add-ons). A member with no tier (null or
 * undefined) resolves to DEFAULT_TIER ('low', Service provider); an explicit
 * 'basic' stays the view-only self-baseline.
 */
const effectiveCapabilities = (user) => {
    const set = new Set(BASIC);
    TIERS[resolvedTier(user)].forEach((c) => set.add(c));
    flagCapabilities(user && user.staffPermissions).forEach((c) => set.add(c));
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
    CAPABILITIES, GRANTABLE, TIERS, TIER_NAMES, DEFAULT_TIER,
    can, validate, isTier, effectiveCapabilities, resolvedTier,
};
