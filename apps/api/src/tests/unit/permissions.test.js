/**
 * Permission capabilities & tiers (utils/permissions.js) — the core auth logic.
 * Pure unit tests (no DB): pins the invariants that keep the tier rollout safe —
 * legacy access preserved byte-for-byte, tiers resolve as designed, owners/admins
 * are never gated, and validation rejects junk.
 */
const {
    can, validate, isTier, effectiveCapabilities, resolvedTier,
    CAPABILITIES, TIERS, TIER_NAMES, CALENDAR_ALL, DEFAULT_TIER,
} = require('../../utils/permissions');

const staff = (over = {}) => ({ role: 'staff', staffPermissions: [], staffTier: null, ...over });

describe('can() — role short-circuits', () => {
    it('owner (provider) and admin hold every capability implicitly', () => {
        for (const role of ['provider', 'admin']) {
            expect(can({ role }, 'reports:view')).toBe(true);
            expect(can({ role }, 'team:manage')).toBe(true);
            expect(can({ role }, 'anything:at:all')).toBe(true);
        }
    });
    it('no user, and non-staff non-owner roles, hold nothing', () => {
        expect(can(null, 'calendar:view')).toBe(false);
        expect(can({ role: 'customer' }, 'calendar:view')).toBe(false);
    });
});

describe('legacy preservation — the byte-for-byte guarantee', () => {
    it('a calendar:all holder still passes calendar:view_all (the moved seam)', () => {
        const legacy = staff({ staffPermissions: [CALENDAR_ALL] });
        expect(can(legacy, 'calendar:view_all')).toBe(true);
        // …and still answers the legacy key, since callers may pass either.
        expect(can(legacy, 'calendar:all')).toBe(true);
    });
    it('the default invite flags never grant the whole-business view', () => {
        const fresh = staff({ staffPermissions: ['calendar:self', 'clients:assigned'] });
        expect(can(fresh, 'calendar:view_all')).toBe(false);
        expect(can(fresh, 'clients:view')).toBe(false);
        expect(can(fresh, 'calendar:view')).toBe(true); // own calendar, always
    });
    it('descriptive flags map to no capability beyond the baseline', () => {
        const eff = effectiveCapabilities(staff({ staffPermissions: ['calendar:self', 'clients:assigned'] }));
        expect(eff.has('calendar:view_all')).toBe(false);
        expect(eff.has('clients:view')).toBe(false);
    });
});

describe('tiers resolve cumulatively', () => {
    it('basic < low < medium < high, each a strict superset', () => {
        expect(TIER_NAMES).toEqual(['basic', 'low', 'medium', 'high']);
        expect(TIERS.basic.every(c => TIERS.low.includes(c))).toBe(true);
        expect(TIERS.low.every(c => TIERS.medium.includes(c))).toBe(true);
        expect(TIERS.medium.every(c => TIERS.high.includes(c))).toBe(true);
        expect(TIERS.low.length).toBeGreaterThan(TIERS.basic.length);
        expect(TIERS.medium.length).toBeGreaterThan(TIERS.low.length);
        expect(TIERS.high.length).toBeGreaterThan(TIERS.medium.length);
    });
    it('medium grants whole-business calendar + client book, not reports', () => {
        const m = staff({ staffTier: 'medium' });
        expect(can(m, 'calendar:view_all')).toBe(true);
        expect(can(m, 'clients:view')).toBe(true);
        expect(can(m, 'reports:view')).toBe(false);
        expect(can(m, 'team:manage')).toBe(false);
    });
    it('low grants own-booking actions but not whole-business view', () => {
        const l = staff({ staffTier: 'low' });
        expect(can(l, 'bookings:cancel:self')).toBe(true);
        expect(can(l, 'bookings:create')).toBe(true);
        expect(can(l, 'calendar:view_all')).toBe(false);
    });
    it('high grants reports + catalogue + team management', () => {
        const h = staff({ staffTier: 'high' });
        expect(can(h, 'reports:view')).toBe(true);
        expect(can(h, 'services:edit')).toBe(true);
        expect(can(h, 'team:manage')).toBe(true);
    });
    it('tier and legacy flags union (a tiered member keeps a legacy grant)', () => {
        const l = staff({ staffTier: 'low', staffPermissions: [CALENDAR_ALL] });
        expect(can(l, 'calendar:view_all')).toBe(true); // from the legacy flag
        expect(can(l, 'bookings:create')).toBe(true);    // from the tier
    });

    it('a capability stored in staffPermissions is a per-member override', () => {
        // The owner can layer a single extra capability on a member without moving
        // their whole tier — validate() stores it, effective set honours it.
        const m = staff({ staffPermissions: ['reports:view'] }); // no tier
        expect(can(m, 'reports:view')).toBe(true);   // granted via the override channel
        expect(can(m, 'services:edit')).toBe(false); // nothing else leaks in
        expect(can(m, 'calendar:view_all')).toBe(false);
    });
});

describe('no level chosen → Service provider; explicit basic → view-only', () => {
    it('the default is the Service-provider tier', () => {
        expect(DEFAULT_TIER).toBe('low');
        expect(resolvedTier(staff({ staffTier: null }))).toBe('low');
        expect(resolvedTier({ role: 'staff' })).toBe('low'); // undefined, e.g. a cached user
        expect(resolvedTier(staff({ staffTier: 'basic' }))).toBe('basic');
        expect(resolvedTier(staff({ staffTier: 'medium' }))).toBe('medium');
        // A value the schema should never admit fails CLOSED to view-only.
        expect(resolvedTier(staff({ staffTier: 'superuser' }))).toBe('basic');
    });
    it('null / undefined tier: books and blocks their own time, nothing business-wide', () => {
        for (const m of [staff({ staffTier: null }), { role: 'staff' }]) {
            expect(can(m, 'bookings:create')).toBe(true);
            expect(can(m, 'calendar:block:self')).toBe(true);
            expect(can(m, 'bookings:status:self')).toBe(true);
            expect(can(m, 'calendar:manage')).toBe(false);
            expect(can(m, 'clients:view')).toBe(false);
            expect(can(m, 'clients:view_all')).toBe(false);
            expect(can(m, 'calendar:view_all')).toBe(false);
        }
    });
    it('an explicit basic member is view-only: no booking, no blocking', () => {
        const b = staff({ staffTier: 'basic' });
        expect(can(b, 'calendar:view')).toBe(true);
        expect(can(b, 'clients:assigned')).toBe(true);
        expect(can(b, 'bookings:create')).toBe(false);
        expect(can(b, 'calendar:block:self')).toBe(false);
        expect(can(b, 'bookings:status:self')).toBe(false);
    });
    it('low blocks its own lane only; medium+ manages the whole calendar', () => {
        expect(can(staff({ staffTier: 'low' }), 'calendar:block:self')).toBe(true);
        expect(can(staff({ staffTier: 'low' }), 'calendar:manage')).toBe(false);
        expect(can(staff({ staffTier: 'medium' }), 'calendar:block:self')).toBe(true);
        expect(can(staff({ staffTier: 'medium' }), 'calendar:manage')).toBe(true);
        expect(can(staff({ staffTier: 'high' }), 'calendar:manage')).toBe(true);
    });
});

describe('validate() & isTier()', () => {
    it('accepts capabilities + legacy/descriptive flags, rejects junk', () => {
        const { accepted, rejected } = validate(['calendar:all', 'reports:view', 'calendar:self', 'bogus:cap']);
        expect(accepted).toEqual(expect.arrayContaining(['calendar:all', 'reports:view', 'calendar:self']));
        expect(rejected).toEqual(['bogus:cap']);
    });
    it('accepts the own-lane blocking capability', () => {
        expect(validate(['calendar:block:self']).accepted).toEqual(['calendar:block:self']);
    });
    it('every tier capability is a known capability (no orphan grants)', () => {
        const known = new Set(CAPABILITIES);
        for (const name of TIER_NAMES) {
            for (const cap of TIERS[name]) expect(known.has(cap)).toBe(true);
        }
    });
    it('isTier recognises only the four preset names', () => {
        expect(TIER_NAMES.every(isTier)).toBe(true);
        expect(isTier('owner')).toBe(false);
        expect(isTier(null)).toBe(false);
        expect(isTier('nope')).toBe(false);
    });
});
