/**
 * A team member does not inherit blocked time that was never about them.
 *
 * Blocked time is scoped three ways (models/BlockedTime): one member's lane, the
 * owner's own lane (ownerOnly), or business-wide. The ownerOnly flag only
 * arrived on 2026-09-01 — before it, an owner blocking their own lunch and a
 * genuine closure were stored identically as `teamMember: null`, so every such
 * row still closes EVERY member's day.
 *
 * These pin both halves: the live scoping rule, and the backfill that re-scopes
 * the legacy rows without disturbing deliberate ones.
 */
const testDb = require('../helpers/testDb');
const BlockedTime = require('../../models/BlockedTime');
const TeamMember = require('../../models/TeamMember');
const { makeProvider } = require('../helpers/factories');
const { migrateBlockedTimeScope } = require('../../../scripts/migrate_blocked_time_scope');
const { findBlocksForDate } = require('../../utils/blockedTime');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const DATE = '2026-10-01';
const before = new Date('2026-08-15T10:00:00.000Z');  // legacy: predates the fix
const after = new Date('2026-09-10T10:00:00.000Z');   // deliberate: since the fix

// createdAt is set by mongoose timestamps, so force it explicitly.
const blockAt = async (createdAt, fields) => {
    const doc = await BlockedTime.create({ date: DATE, startTime: '12:00', endTime: '13:00', ...fields });
    if (createdAt) await BlockedTime.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
    return doc;
};

describe('blocked-time scope — who a block actually closes', () => {
    it('a member sees business-wide and their OWN blocks, never a colleague\'s or the owner\'s', async () => {
        const owner = await makeProvider();
        const erastus = await TeamMember.create({ provider: owner._id, name: 'Erastus', role: 'Cleaner', email: 'e@t.com' });
        const john = await TeamMember.create({ provider: owner._id, name: 'John', role: 'Barber', email: 'j@t.com' });

        await blockAt(after, { provider: owner._id, teamMember: null, ownerOnly: true, reason: "owner's lunch" });
        await blockAt(after, { provider: owner._id, teamMember: john._id, reason: "john's dentist" });
        await blockAt(after, { provider: owner._id, teamMember: erastus._id, reason: "erastus's errand" });
        await blockAt(after, { provider: owner._id, teamMember: null, ownerOnly: false, reason: 'public holiday' });

        const forErastus = await findBlocksForDate(owner._id, DATE, erastus._id);
        const reasons = forErastus.map((b) => b.reason).sort();
        expect(reasons).toEqual(['erastus\'s errand', 'public holiday']);
        expect(reasons).not.toContain("owner's lunch");
        expect(reasons).not.toContain("john's dentist");
    });
});

describe('migrate_blocked_time_scope — free the team from legacy owner blocks', () => {
    it('re-scopes pre-cutoff business-wide blocks to the owner and leaves the rest alone', async () => {
        const owner = await makeProvider();
        const member = await TeamMember.create({ provider: owner._id, name: 'Erastus', role: 'Cleaner', email: 'e@t.com' });

        const legacy = await blockAt(before, { provider: owner._id, teamMember: null, ownerOnly: false, reason: 'august lunch' });
        const deliberate = await blockAt(after, { provider: owner._id, teamMember: null, ownerOnly: false, reason: 'public holiday' });
        const alreadyOwner = await blockAt(before, { provider: owner._id, teamMember: null, ownerOnly: true, reason: 'already scoped' });
        const memberBlock = await blockAt(before, { provider: owner._id, teamMember: member._id, reason: "member's own" });

        const first = await migrateBlockedTimeScope();
        expect(first.converted).toBe(1);
        expect(first.affected.map((b) => b.reason)).toEqual(['august lunch']);
        expect(first.keptBusinessWide).toBe(1); // the deliberate one survives

        expect((await BlockedTime.findById(legacy._id)).ownerOnly).toBe(true);
        expect((await BlockedTime.findById(deliberate._id)).ownerOnly).toBe(false);
        expect((await BlockedTime.findById(alreadyOwner._id)).ownerOnly).toBe(true);
        const m = await BlockedTime.findById(memberBlock._id);
        expect(String(m.teamMember)).toBe(String(member._id)); // untouched

        // The point of the whole thing: the member's day is no longer closed by it.
        const forMember = await findBlocksForDate(owner._id, DATE, member._id);
        expect(forMember.map((b) => b.reason).sort()).toEqual(["member's own", 'public holiday']);

        // Re-running writes nothing — the deploy runs this on every release.
        const second = await migrateBlockedTimeScope();
        expect(second.converted).toBe(0);
    });

    it('treats a row with no createdAt as legacy — it predates timestamps entirely', async () => {
        const owner = await makeProvider();
        const doc = await BlockedTime.create({ provider: owner._id, teamMember: null, ownerOnly: false, date: DATE, startTime: '09:00', endTime: '10:00', reason: 'ancient' });
        await BlockedTime.collection.updateOne({ _id: doc._id }, { $unset: { createdAt: '' } });

        const res = await migrateBlockedTimeScope();
        expect(res.converted).toBe(1);
        expect((await BlockedTime.findById(doc._id)).ownerOnly).toBe(true);
    });

    it('converts every occurrence of a legacy RECURRING block, not just the first', async () => {
        const owner = await makeProvider();
        for (const d of ['2026-10-01', '2026-10-08', '2026-10-15']) {
            const doc = await BlockedTime.create({
                provider: owner._id, teamMember: null, ownerOnly: false,
                date: d, startTime: '12:00', endTime: '13:00', reason: 'weekly lunch',
                isRecurring: true, recurrenceType: 'weekly', recurrenceGroupId: 'grp-1',
            });
            await BlockedTime.collection.updateOne({ _id: doc._id }, { $set: { createdAt: before } });
        }

        const res = await migrateBlockedTimeScope();
        expect(res.converted).toBe(3);
        expect(await BlockedTime.countDocuments({ recurrenceGroupId: 'grp-1', ownerOnly: true })).toBe(3);
    });
});
