/**
 * Permission capabilities & tiers (utils/permissions.js) — the core auth logic.
 * Pure unit tests (no DB): pins the invariants that keep the tier rollout safe —
 * legacy access preserved byte-for-byte, tiers resolve as designed, owners/admins
 * are never gated, and validation rejects junk.
 */
const {
    can, validate, isTier, effectiveCapabilities,
    CAPABILITIES, TIERS, TIER_NAMES, CALENDAR_ALL,
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
    it('the default invite flags grant only the self-baseline (no whole-business view)', () => {
        const basic = staff({ staffPermissions: ['calendar:self', 'clients:assigned'] });
        expect(can(basic, 'calendar:view_all')).toBe(false);
        expect(can(basic, 'calendar:view')).toBe(true); // own calendar, always
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

describe('validate() & isTier()', () => {
    it('accepts capabilities + legacy/descriptive flags, rejects junk', () => {
        const { accepted, rejected } = validate(['calendar:all', 'reports:view', 'calendar:self', 'bogus:cap']);
        expect(accepted).toEqual(expect.arrayContaining(['calendar:all', 'reports:view', 'calendar:self']));
        expect(rejected).toEqual(['bogus:cap']);
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
