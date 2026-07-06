/**
 * Epic 2.1 — multi-staff schema (DUAL_APP_SPEC.md §3) + the one-off
 * TeamMember colour migration from the rebrand.
 *
 * These are model-level guarantees; endpoint behavior lands in Epic 2.2.
 */
const db = require('../helpers/testDb');
const User = require('../../models/User');
const TeamMember = require('../../models/TeamMember');
const StaffAvailability = require('../../models/StaffAvailability');
const BlockedTime = require('../../models/BlockedTime');
const { migrateTeamColors } = require('../../../scripts/migrate_team_colors');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const makeProvider = (n = 0) => User.create({
    name: `Prov ${n}`, email: `prov${n}@example.com`, password: 'Password1!',
    phone: '+264810000000', role: 'provider',
});

describe('User — staff principal (spec §3.1)', () => {
    it("accepts role 'staff' with staffOf + staffPermissions", async () => {
        const owner = await makeProvider();
        const staff = await User.create({
            name: 'Staffer', email: 'staffer@example.com', password: 'Password1!',
            phone: '+264810000001', role: 'staff', staffOf: owner._id,
            staffPermissions: ['calendar:self', 'clients:assigned'],
        });
        expect(staff.role).toBe('staff');
        expect(staff.staffOf.toString()).toBe(owner._id.toString());
        expect(staff.staffPermissions).toEqual(['calendar:self', 'clients:assigned']);
    });

    it('defaults staffOf to null and staffPermissions to [] for other roles', async () => {
        const u = await User.create({
            name: 'Cust', email: 'cust@example.com', password: 'Password1!',
            phone: '+264810000002',
        });
        expect(u.role).toBe('customer');
        expect(u.staffOf).toBeNull();
        expect(u.staffPermissions).toEqual([]);
    });

    it('still rejects unknown roles', async () => {
        await expect(User.create({
            name: 'X', email: 'x@example.com', password: 'Password1!',
            phone: '+264810000003', role: 'superuser',
        })).rejects.toThrow(/role/i);
    });
});

describe('TeamMember — login link + service mapping (spec §3.2)', () => {
    it('defaults user to null (roster-only) and services to [] (all services)', async () => {
        const owner = await makeProvider();
        const tm = await TeamMember.create({ provider: owner._id, name: 'Chair One' });
        expect(tm.user).toBeNull();
        expect(tm.services).toEqual([]);
        expect(tm.color).toBe('#f03e16'); // new brand default
    });

    it('links a staff User when invited', async () => {
        const owner = await makeProvider();
        const staffUser = await User.create({
            name: 'Linked', email: 'linked@example.com', password: 'Password1!',
            phone: '+264810000004', role: 'staff', staffOf: owner._id,
        });
        const tm = await TeamMember.create({ provider: owner._id, name: 'Linked', user: staffUser._id });
        expect(tm.user.toString()).toBe(staffUser._id.toString());
    });
});

describe('StaffAvailability (spec §3.3)', () => {
    it('stores one schedule per team member and enforces uniqueness', async () => {
        const owner = await makeProvider();
        const tm = await TeamMember.create({ provider: owner._id, name: 'Solo' });
        await StaffAvailability.create({
            provider: owner._id, teamMember: tm._id,
            schedule: { tuesday: { enabled: true, slots: [{ start: '10:00', end: '14:00' }] } },
        });
        // Unique index rejects a second schedule for the same member.
        // (syncIndexes ensures the index exists in the fresh in-memory DB.)
        await StaffAvailability.syncIndexes();
        await expect(StaffAvailability.create({
            provider: owner._id, teamMember: tm._id,
        })).rejects.toThrow(/duplicate/i);
    });
});

describe('BlockedTime — optional staff scope (spec §3.4)', () => {
    it('defaults teamMember to null (business-wide, existing behavior)', async () => {
        const owner = await makeProvider();
        const bt = await BlockedTime.create({
            provider: owner._id, date: '2026-08-01', startTime: '09:00', endTime: '10:00',
        });
        expect(bt.teamMember).toBeNull();
    });

    it('accepts a staff-scoped block', async () => {
        const owner = await makeProvider();
        const tm = await TeamMember.create({ provider: owner._id, name: 'Blocked One' });
        const bt = await BlockedTime.create({
            provider: owner._id, date: '2026-08-01', startTime: '09:00', endTime: '10:00',
            teamMember: tm._id,
        });
        expect(bt.teamMember.toString()).toBe(tm._id.toString());
    });
});

describe('migrate_team_colors (rebrand follow-up)', () => {
    it('recolors only the exact old gold default, preserving custom colours', async () => {
        const owner = await makeProvider();
        await TeamMember.create({ provider: owner._id, name: 'Old Gold', color: '#c9a84c' });
        await TeamMember.create({ provider: owner._id, name: 'Old Gold Caps', color: '#C9A84C' });
        await TeamMember.create({ provider: owner._id, name: 'Custom Teal', color: '#14b8a6' });
        await TeamMember.create({ provider: owner._id, name: 'Already New' }); // default #f03e16

        const n = await migrateTeamColors();
        expect(n).toBe(2);

        const colors = Object.fromEntries(
            (await TeamMember.find({}).lean()).map(t => [t.name, t.color])
        );
        expect(colors['Old Gold']).toBe('#f03e16');
        expect(colors['Old Gold Caps']).toBe('#f03e16');
        expect(colors['Custom Teal']).toBe('#14b8a6');
        expect(colors['Already New']).toBe('#f03e16');

        // Idempotent: second run touches nothing.
        expect(await migrateTeamColors()).toBe(0);
    });
});
