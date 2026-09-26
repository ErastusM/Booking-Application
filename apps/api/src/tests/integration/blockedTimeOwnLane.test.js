/**
 * Blocked time a team member may write.
 *
 *   calendar:block:self (Service provider / Low — and the default for a member
 *     nobody chose a level for): create, edit and delete blocks in their OWN lane
 *     only. Never business-wide (teamMember null), never owner-only, never a
 *     colleague's lane; edits/deletes reach only blocks already in their lane.
 *   calendar:manage (Medium+): the whole business's blocked time, unchanged.
 *   explicit 'basic': view-only — no writes at all.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const TeamMember = require('../../models/TeamMember');
const BlockedTime = require('../../models/BlockedTime');
const { makeUser, makeProvider, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

let seq = 0;
// tier undefined → field left at its default (null: nobody chose a level).
const staff = async (provider, tier) => {
    seq += 1;
    const login = await makeUser({
        role: 'staff', staffOf: provider._id, email: `lane${seq}@test.com`,
        ...(tier !== undefined ? { staffTier: tier } : {}),
    });
    const member = await TeamMember.create({ provider: provider._id, name: `Member ${seq}`, user: login._id });
    return { login, member };
};

const post = (user, body) => request(app).post('/api/blocked-times').set(authHeader(user)).send(body);
const put = (user, id, body) => request(app).put(`/api/blocked-times/${id}`).set(authHeader(user)).send(body);
const del = (user, id, body = {}) => request(app).delete(`/api/blocked-times/${id}`).set(authHeader(user)).send(body);
const blockBody = (extra = {}) => ({ date: '2030-01-07', startTime: '09:00', endTime: '10:00', reason: 'Dentist', ...extra });

// A business with John (no level chosen), a colleague, and one block of every
// kind: John's own, the colleague's, the owner's own, and a business-wide closure.
const setup = async (johnTier) => {
    const owner = await makeProvider();
    const john = await staff(owner, johnTier);
    const colleague = await staff(owner, 'low');
    const [own, colleagues, ownerOnly, wide] = await BlockedTime.create([
        { provider: owner._id, teamMember: john.member._id, date: '2030-01-08', startTime: '14:00', endTime: '15:00', reason: 'own' },
        { provider: owner._id, teamMember: colleague.member._id, date: '2030-01-08', startTime: '14:00', endTime: '15:00', reason: 'colleague' },
        { provider: owner._id, teamMember: null, ownerOnly: true, date: '2030-01-08', startTime: '12:00', endTime: '13:00', reason: 'owner lunch' },
        { provider: owner._id, teamMember: null, date: '2030-01-09', startTime: '00:00', endTime: '23:59', reason: 'public holiday' },
    ]);
    return { owner, john, colleague, blocks: { own, colleagues, ownerOnly, wide } };
};

describe('a member with no level chosen — their own lane', () => {
    test('creates a block in their own lane', async () => {
        const { owner, john } = await setup();
        const res = await post(john.login, blockBody({ teamMember: john.member._id.toString() }));
        expect(res.status).toBe(201);
        expect(String(res.body.data.provider)).toBe(String(owner._id));
        expect(String(res.body.data.teamMember)).toBe(String(john.member._id));
        expect(res.body.data.ownerOnly).toBe(false);
    });

    test('creates a recurring series, every occurrence in their own lane', async () => {
        const { john } = await setup();
        const res = await post(john.login, blockBody({
            teamMember: john.member._id.toString(), isRecurring: true, recurrenceType: 'weekly', recurrenceEndDate: '2030-01-28',
        }));
        expect(res.status).toBe(201);
        expect(res.body.data).toHaveLength(4);
        expect(res.body.data.every((b) => String(b.teamMember) === String(john.member._id) && b.ownerOnly === false)).toBe(true);
    });

    test('an ownerOnly flag next to their own lane cannot turn it into an owner-only block', async () => {
        const { john } = await setup();
        const res = await post(john.login, blockBody({ teamMember: john.member._id.toString(), ownerOnly: true }));
        expect(res.status).toBe(201);
        expect(String(res.body.data.teamMember)).toBe(String(john.member._id));
        expect(res.body.data.ownerOnly).toBe(false);
    });

    test('edits and deletes their own block', async () => {
        const { john, blocks } = await setup();
        const upd = await put(john.login, blocks.own._id, { startTime: '14:30', endTime: '15:30', reason: 'moved' });
        expect(upd.status).toBe(200);
        const after = await BlockedTime.findById(blocks.own._id);
        expect(after.startTime).toBe('14:30');
        expect(after.reason).toBe('moved');
        const rm = await del(john.login, blocks.own._id);
        expect(rm.status).toBe(200);
        expect(await BlockedTime.findById(blocks.own._id)).toBeNull();
    });
});

describe('a member with no level chosen — everything outside their lane is refused', () => {
    test('no business-wide block (no teamMember)', async () => {
        const { john } = await setup();
        const before = await BlockedTime.countDocuments({});
        const res = await post(john.login, blockBody());
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('own_lane_only');
        expect(await BlockedTime.countDocuments({})).toBe(before);
    });

    test('no owner-only block', async () => {
        const { john } = await setup();
        const res = await post(john.login, blockBody({ ownerOnly: true }));
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('own_lane_only');
    });

    test("no block in a colleague's lane — single or recurring", async () => {
        const { john, colleague } = await setup();
        const before = await BlockedTime.countDocuments({});
        const single = await post(john.login, blockBody({ teamMember: colleague.member._id.toString() }));
        expect(single.status).toBe(403);
        const series = await post(john.login, blockBody({
            teamMember: colleague.member._id.toString(), isRecurring: true, recurrenceType: 'daily', recurrenceEndDate: '2030-01-10',
        }));
        expect(series.status).toBe(403);
        expect(await BlockedTime.countDocuments({})).toBe(before);
    });

    test("cannot edit or delete a colleague's, the owner's, or a business-wide block", async () => {
        const { john, blocks } = await setup();
        for (const b of [blocks.colleagues, blocks.ownerOnly, blocks.wide]) {
            const upd = await put(john.login, b._id, { reason: 'hijacked' });
            expect(upd.status).toBe(403);
            expect(upd.body.code).toBe('own_lane_only');
            const rm = await del(john.login, b._id);
            expect(rm.status).toBe(403);
        }
        const reasons = (await BlockedTime.find({}).lean()).map((b) => b.reason).sort();
        expect(reasons).toEqual(['colleague', 'own', 'owner lunch', 'public holiday']);
    });

    test("a series edit/delete of their own block never reaches another lane sharing the group id", async () => {
        const { owner, john, colleague } = await setup();
        const shared = [
            { provider: owner._id, teamMember: john.member._id, date: '2030-02-04', startTime: '09:00', endTime: '10:00', reason: 'mine', isRecurring: true, recurrenceType: 'weekly', recurrenceGroupId: 'grp-1' },
            { provider: owner._id, teamMember: john.member._id, date: '2030-02-11', startTime: '09:00', endTime: '10:00', reason: 'mine', isRecurring: true, recurrenceType: 'weekly', recurrenceGroupId: 'grp-1' },
            { provider: owner._id, teamMember: colleague.member._id, date: '2030-02-11', startTime: '09:00', endTime: '10:00', reason: 'theirs', isRecurring: true, recurrenceType: 'weekly', recurrenceGroupId: 'grp-1' },
        ];
        const [first] = await BlockedTime.create(shared);
        const upd = await put(john.login, first._id, { reason: 'renamed', updateMode: 'all' });
        expect(upd.status).toBe(200);
        expect(await BlockedTime.countDocuments({ recurrenceGroupId: 'grp-1', reason: 'renamed' })).toBe(2);
        expect(await BlockedTime.countDocuments({ recurrenceGroupId: 'grp-1', reason: 'theirs' })).toBe(1);
        const rm = await del(john.login, first._id, { deleteMode: 'all' });
        expect(rm.status).toBe(200);
        const left = await BlockedTime.find({ recurrenceGroupId: 'grp-1' }).lean();
        expect(left.map((b) => b.reason)).toEqual(['theirs']);
    });

    test("another business's staff can't touch this business's blocks", async () => {
        const { blocks } = await setup();
        const otherOwner = await makeProvider();
        const stranger = await staff(otherOwner);
        expect((await put(stranger.login, blocks.own._id, { reason: 'x' })).status).toBe(404);
        expect((await del(stranger.login, blocks.own._id)).status).toBe(404);
    });

    test('a login with no roster row cannot block anything', async () => {
        const owner = await makeProvider();
        const orphan = await makeUser({ role: 'staff', staffOf: owner._id, email: 'orphan@test.com' });
        const res = await post(orphan, blockBody({ teamMember: '000000000000000000000000' }));
        expect(res.status).toBe(403);
    });
});

describe('an explicit Service provider (low) holds the same own-lane power', () => {
    test('own lane 201, business-wide 403', async () => {
        const { john } = await setup('low');
        expect((await post(john.login, blockBody({ teamMember: john.member._id.toString() }))).status).toBe(201);
        expect((await post(john.login, blockBody())).status).toBe(403);
    });
});

describe('an explicit Basic (view-only) member writes nothing', () => {
    test('create, edit and delete in their own lane are refused at the route', async () => {
        const { john, blocks } = await setup('basic');
        expect((await post(john.login, blockBody({ teamMember: john.member._id.toString() }))).status).toBe(403);
        expect((await put(john.login, blocks.own._id, { reason: 'x' })).status).toBe(403);
        expect((await del(john.login, blocks.own._id)).status).toBe(403);
        expect(await BlockedTime.findById(blocks.own._id)).not.toBeNull();
    });
});

describe('Medium and High keep whole-business power', () => {
    test('Medium blocks the whole business and a colleague, and edits/deletes any block', async () => {
        const { owner, colleague, blocks } = await setup();
        const medium = await staff(owner, 'medium');
        const wide = await post(medium.login, blockBody());
        expect(wide.status).toBe(201);
        expect(wide.body.data.teamMember).toBeNull();
        const lane = await post(medium.login, blockBody({ teamMember: colleague.member._id.toString() }));
        expect(lane.status).toBe(201);
        expect((await put(medium.login, blocks.colleagues._id, { reason: 'edited' })).status).toBe(200);
        expect((await del(medium.login, blocks.wide._id)).status).toBe(200);
    });

    test('High may still create an owner-only block', async () => {
        const { owner } = await setup();
        const high = await staff(owner, 'high');
        const res = await post(high.login, blockBody({ ownerOnly: true }));
        expect(res.status).toBe(201);
        expect(res.body.data.ownerOnly).toBe(true);
    });
});
