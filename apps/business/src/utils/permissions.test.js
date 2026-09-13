import { describe, it, expect } from 'vitest';
import { can, canAny, effectiveCapabilities } from './permissions';

// UI-visibility mirror of the backend can(); real enforcement is server-side.
describe('frontend capability resolver', () => {
    it('owners and admins hold everything', () => {
        expect(can({ role: 'provider' }, 'team:manage')).toBe(true);
        expect(can({ role: 'admin' }, 'wallet:view')).toBe(true);
        expect(can({ role: 'provider' }, 'anything:at:all')).toBe(true);
    });

    it('a null / non-staff user holds nothing', () => {
        expect(can(null, 'calendar:view_all')).toBe(false);
        expect(can({ role: 'customer' }, 'clients:view')).toBe(false);
    });

    it('a Medium staff member gets the reception set but not High capabilities', () => {
        const medium = { role: 'staff', staffTier: 'medium' };
        expect(can(medium, 'calendar:view_all')).toBe(true);
        expect(can(medium, 'clients:view')).toBe(true);
        expect(can(medium, 'clients:edit')).toBe(true);
        expect(can(medium, 'calendar:manage')).toBe(true);
        expect(can(medium, 'forms:manage')).toBe(true);
        // High-only:
        expect(can(medium, 'reports:view')).toBe(false);
        expect(can(medium, 'team:manage')).toBe(false);
        expect(can(medium, 'services:edit')).toBe(false);
    });

    it('a Low staff member cannot see the whole calendar or clients', () => {
        const low = { role: 'staff', staffTier: 'low' };
        expect(can(low, 'bookings:create')).toBe(true);
        expect(can(low, 'calendar:view_all')).toBe(false);
        expect(can(low, 'clients:view')).toBe(false);
    });

    it('no tier (null) resolves to the Basic self-baseline only', () => {
        const basic = { role: 'staff', staffTier: null };
        expect(can(basic, 'calendar:view')).toBe(true); // baseline
        expect(can(basic, 'calendar:view_all')).toBe(false);
        expect(can(basic, 'clients:view')).toBe(false);
    });

    it('the legacy calendar:all flag maps to calendar:view_all', () => {
        const legacy = { role: 'staff', staffTier: null, staffPermissions: ['calendar:all'] };
        expect(can(legacy, 'calendar:view_all')).toBe(true);
        expect(effectiveCapabilities(legacy).has('calendar:view_all')).toBe(true);
    });

    it('canAny is true when any listed capability is held', () => {
        const medium = { role: 'staff', staffTier: 'medium' };
        expect(canAny(medium, ['reports:view', 'clients:view'])).toBe(true);
        expect(canAny(medium, ['reports:view', 'team:manage'])).toBe(false);
    });
});
