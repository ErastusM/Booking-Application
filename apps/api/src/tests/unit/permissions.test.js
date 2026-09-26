/**
 * One kind of team member (utils/permissions.js). "I don't think we should have
 * high or low members. Just members." Pure unit tests (no DB): owners/admins are
 * never gated, and every team member — whatever access level or grant their old
 * record still holds — resolves to exactly the member set, with nothing
 * business-wide in it.
 */
const { can, effectiveCapabilities, MEMBER } = require('../../utils/permissions');

const BUSINESS_WIDE = [
    'calendar:view_all', 'calendar:all', 'calendar:manage', 'clients:view', 'clients:view_all', 'clients:edit',
    'clients:contact', 'bookings:status', 'bookings:reschedule', 'bookings:cancel', 'bookings:edit',
    'forms:manage', 'reports:view', 'services:edit', 'prices:edit', 'packages:manage', 'availability:manage',
    'team:manage', 'wallet:view', 'settings:edit',
];
const FORMER_RECORDS = [
    {}, { staffTier: null }, { staffTier: 'basic' }, { staffTier: 'low' }, { staffTier: 'medium' }, { staffTier: 'high' },
    { staffTier: 'bogus' },
    { staffPermissions: ['calendar:all'] },
    { staffTier: 'basic', staffPermissions: ['clients:view_all'] },
    { staffTier: 'high', staffPermissions: ['team:manage', 'wallet:view', 'reports:view', 'services:edit'] },
];

describe('can() — owners and admins', () => {
    it('hold every capability implicitly', () => {
        for (const role of ['provider', 'admin']) {
            [...MEMBER, ...BUSINESS_WIDE, 'anything:at:all'].forEach((c) => expect(can({ role }, c)).toBe(true));
        }
    });

    it('nobody else holds anything', () => {
        expect(can(null, 'calendar:view')).toBe(false);
        expect(can({ role: 'customer' }, 'calendar:view')).toBe(false);
    });
});

describe('every team member holds exactly the member set', () => {
    it.each(FORMER_RECORDS.map((r) => [JSON.stringify(r), r]))('%s', (_label, rec) => {
        const u = { role: 'staff', ...rec };
        MEMBER.forEach((c) => expect(can(u, c)).toBe(true));
        BUSINESS_WIDE.forEach((c) => expect(can(u, c)).toBe(false));
        expect([...effectiveCapabilities(u)].sort()).toEqual([...MEMBER].sort());
    });

    it('the member set is about THEM: own calendar, bookings, clients, blocks, services, hours, time off, waiting list', () => {
        expect(MEMBER).toEqual(expect.arrayContaining([
            'calendar:view', 'calendar:block:self', 'bookings:create', 'bookings:status:self',
            'bookings:reschedule:self', 'bookings:cancel:self', 'clients:assigned', 'clients:contact:self',
            'services:self', 'prices:self', 'availability:self', 'timeoff:self', 'waitlist:manage', 'account:self',
        ]));
        BUSINESS_WIDE.forEach((c) => expect(MEMBER).not.toContain(c));
    });
});
