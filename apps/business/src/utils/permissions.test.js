import { describe, it, expect } from 'vitest';
import { can, canAny, effectiveCapabilities, MEMBER } from './permissions';

// UI-visibility mirror of the backend can(); real enforcement is server-side.
// "Just members": one kind of team member, whatever old fields say.
const BUSINESS_WIDE = [
    'calendar:view_all', 'calendar:manage', 'clients:view', 'clients:view_all', 'clients:edit', 'clients:contact',
    'bookings:status', 'bookings:reschedule', 'bookings:cancel', 'bookings:edit', 'forms:manage',
    'reports:view', 'services:edit', 'prices:edit', 'packages:manage', 'availability:manage',
    'team:manage', 'wallet:view', 'settings:edit',
];
const FORMER = [
    { staffTier: 'basic' }, { staffTier: 'low' }, { staffTier: 'medium' }, { staffTier: 'high' }, { staffTier: null }, {},
    { staffTier: 'high', staffPermissions: ['clients:view_all', 'calendar:all', 'team:manage'] },
];

describe('frontend capability resolver', () => {
    it('owners and admins hold everything', () => {
        expect(can({ role: 'provider' }, 'team:manage')).toBe(true);
        expect(can({ role: 'admin' }, 'wallet:view')).toBe(true);
    });

    it('a null / non-staff user holds nothing', () => {
        expect(can(null, 'calendar:view')).toBe(false);
        expect(can({ role: 'customer' }, 'clients:assigned')).toBe(false);
    });

    it('every team member — whatever level they once had — holds exactly the member set', () => {
        FORMER.forEach((f) => {
            const u = { role: 'staff', ...f };
            MEMBER.forEach((c) => expect(can(u, c)).toBe(true));
            BUSINESS_WIDE.forEach((c) => expect(can(u, c)).toBe(false));
            expect(can(u, 'calendar:all')).toBe(false); // legacy alias of view_all
            expect([...effectiveCapabilities(u)].sort()).toEqual([...MEMBER].sort());
        });
    });

    it('canAny passes when any listed capability is held', () => {
        const m = { role: 'staff' };
        expect(canAny(m, ['team:manage', 'calendar:view'])).toBe(true);
        expect(canAny(m, ['team:manage', 'wallet:view'])).toBe(false);
    });
});
