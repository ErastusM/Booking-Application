/**
 * A team member does not inherit blocked time that was never about them.
 *
 * Blocked time is scoped two ways (models/BlockedTime): one member's lane, or
 * the owner's own lane (teamMember null). The owner's decision: the owner's
 * blocked times never apply to members — so a null-scoped row is the owner's
 * whether or not it carries ownerOnly (older rows were saved "business-wide").
 *
 * These pin the live scoping rule, the old backfill (migrate_blocked_time_scope)
 * and the new one that marks every null-scoped row as the owner's own
 * (migrate_owner_blocks_owner_only).
 */
const request = require('supertest');
const testDb = require('../helpers/testDb');
const BlockedTime = require('../../models/BlockedTime');
const TeamMember = require('../../models/TeamMember');
const { makeProvider, authHeader } = require('../helpers/factories');
const { migrateBlockedTimeScope } = require('../../../scripts/migrate_blocked_time_scope');
const { migrateOwnerBlocksOwnerOnly, report } = require('../../../scripts/migrate_owner_blocks_owner_only');
const { findBlocksForDate } = require('../../utils/blockedTime');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');

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
    it('a member is closed only by their OWN blocks — never a colleague\'s or the owner\'s (a legacy business-wide row included)', async () => {
        const owner = await makeProvider();
        const erastus = await TeamMember.create({ provider: owner._id, name: 'Erastus', role: 'Cleaner', email: 'e@t.com' });
        const john = await TeamMember.create({ provider: owner._id, name: 'John', role: 'Barber', email: 'j@t.com' });

        await blockAt(after, { provider: owner._id, teamMember: null, ownerOnly: true, reason: "owner's lunch" });
        await blockAt(after, { provider: owner._id, teamMember: john._id, reason: "john's dentist" });
        await blockAt(after, { provider: owner._id, teamMember: erastus._id, reason: "erastus's errand" });
        await blockAt(after, { provider: owner._id, teamMember: null, ownerOnly: false, reason: 'public holiday' });

        const forErastus = await findBlocksForDate(owner._id, DATE, erastus._id);
        const reasons = forErastus.map((b) => b.reason).sort();
        expect(reasons).toEqual(['erastus\'s errand']);
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
        expect(forMember.map((b) => b.reason).sort()).toEqual(["member's own"]);

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

describe('migrate_owner_blocks_owner_only — every owner block is the owner\'s own', () => {
    const seed = async () => {
        const owner = await makeProvider();
        const other = await makeProvider();
        const member = await TeamMember.create({ provider: owner._id, name: 'Moses', role: 'Barber', email: 'm@t.com' });
        const wide = await blockAt(after, { provider: owner._id, teamMember: null, ownerOnly: false, reason: 'closed Mondays' });
        const wide2 = await blockAt(before, { provider: owner._id, teamMember: null, reason: 'old lunch' });
        const otherWide = await blockAt(after, { provider: other._id, teamMember: null, ownerOnly: false, reason: 'holiday' });
        const mine = await blockAt(after, { provider: owner._id, teamMember: null, ownerOnly: true, reason: 'already owner' });
        const memberBlock = await blockAt(after, { provider: owner._id, teamMember: member._id, reason: "moses's own" });
        return { owner, other, member, wide, wide2, otherWide, mine, memberBlock };
    };

    it('--dry-run counts per business and writes nothing', async () => {
        const ctx = await seed();
        const r = await migrateOwnerBlocksOwnerOnly({ dryRun: true });
        expect(r).toMatchObject({ dryRun: true, found: 3, changed: 0 });
        expect(r.perProvider).toEqual({ [String(ctx.owner._id)]: 2, [String(ctx.other._id)]: 1 });
        expect(await BlockedTime.countDocuments({ teamMember: null, ownerOnly: { $ne: true } })).toBe(3);
        const lines = report(r);
        expect(lines[0]).toMatch(/dry run.*would mark 3/);
        expect(lines.join('\n')).not.toMatch(/Rollback/);
    });

    it('marks every null-scoped block ownerOnly, leaves the rest, prints a rollback — and is idempotent', async () => {
        const ctx = await seed();
        const r = await migrateOwnerBlocksOwnerOnly();
        expect(r).toMatchObject({ dryRun: false, found: 3, changed: 3 });
        expect(r.ids.sort()).toEqual([ctx.wide, ctx.wide2, ctx.otherWide].map((d) => String(d._id)).sort());
        for (const d of [ctx.wide, ctx.wide2, ctx.otherWide, ctx.mine]) {
            expect((await BlockedTime.findById(d._id)).ownerOnly).toBe(true);
        }
        const m = await BlockedTime.findById(ctx.memberBlock._id);
        expect(String(m.teamMember)).toBe(String(ctx.member._id));
        expect(m.ownerOnly).toBe(false);

        const lines = report(r);
        expect(lines[0]).toMatch(/marked 3 owner block/);
        expect(lines).toContain(`  business ${ctx.owner._id}: 2`);
        const rollback = lines.find((l) => l.includes('Rollback'));
        r.ids.forEach((id) => expect(rollback).toContain(`ObjectId("${id}")`));
        expect(rollback).not.toContain(String(ctx.mine._id));

        const again = await migrateOwnerBlocksOwnerOnly();
        expect(again).toMatchObject({ found: 0, changed: 0 });
        expect(report(again).join('\n')).not.toMatch(/Rollback/);
    });
});

describe('POST /api/blocked-times — there is no "everyone" block any more', () => {
    it('a block with no member is stored as the owner\'s own (ownerOnly), whatever the client sends', async () => {
        const owner = await makeProvider();
        const member = await TeamMember.create({ provider: owner._id, name: 'Moses', role: 'Barber', email: 'm2@t.com' });
        const post = (body) => request(app).post('/api/blocked-times').set(authHeader(owner))
            .send({ date: DATE, startTime: '09:00', endTime: '10:00', ...body });

        const bare = await post({});
        expect(bare.status).toBe(201);
        expect(bare.body.data).toMatchObject({ teamMember: null, ownerOnly: true });
        const wide = await post({ ownerOnly: false });
        expect(wide.status).toBe(201);
        expect(wide.body.data.ownerOnly).toBe(true);
        const series = await post({ isRecurring: true, recurrenceType: 'weekly', recurrenceEndDate: '2026-10-15' });
        expect(series.status).toBe(201);
        expect(series.body.data.every((b) => b.ownerOnly === true && b.teamMember === null)).toBe(true);
        // A member's lane is still the owner's to block.
        const lane = await post({ teamMember: String(member._id) });
        expect(lane.status).toBe(201);
        expect(lane.body.data).toMatchObject({ teamMember: String(member._id), ownerOnly: false });
        // None of the owner's blocks close Moses's day.
        const forMoses = await findBlocksForDate(owner._id, DATE, member._id);
        expect(forMoses).toHaveLength(1);
    });
});
