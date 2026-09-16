/**
 * Bulk add: POST /api/team/bulk creates several roster rows in one call, each
 * validated independently — a bad row is reported in `results`, it doesn't fail
 * the batch. Invite (which mints a login) is intentionally NOT part of this;
 * bulk only creates roster entries, all scoped to the caller's business.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, authHeader } = require('../helpers/factories');
const TeamMember = require('../../models/TeamMember');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const bulk = (as, members) => request(app).post('/api/team/bulk').set(authHeader(as)).send({ members });

describe('POST /api/team/bulk', () => {
    it('creates several members at once, all scoped to the caller business', async () => {
        const provider = await makeProvider();
        const res = await bulk(provider, [
            { name: 'Alice', role: 'Barber', email: 'alice@test.com' },
            { name: 'Bob', role: 'Cleaner', email: 'BOB@Test.com' },
            { name: 'Carol', role: 'Manager', email: 'carol@test.com' },
        ]);
        expect(res.status).toBe(201);
        expect(res.body.data.created).toBe(3);
        expect(res.body.data.failed).toBe(0);
        expect(res.body.data.results.every((r) => r.ok)).toBe(true);

        const rows = await TeamMember.find({ provider: provider._id }).sort({ createdAt: 1 });
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Carol']);
        expect(rows[1].email).toBe('bob@test.com');   // normalized like addTeamMember
        expect(rows[0].role).toBe('Barber');
        expect(rows[2].role).toBe('Manager');         // no silent "Staff" default any more
        expect(rows.every((r) => r.offersAllServices === false)).toBe(true);
    });

    it('reports a bad row without failing the good ones', async () => {
        const provider = await makeProvider();
        const res = await bulk(provider, [
            { name: 'Good One', role: 'Cleaner', email: 'g1@test.com' },
            { name: '   ', role: 'Cleaner', email: 'blank@test.com' },   // blank name → reported, not created
            { name: 'No Title', email: 'nt@test.com' },                  // missing job title → reported
            { name: 'No Email', role: 'Cleaner' },                       // missing email → reported
            { name: 'Good Two', role: 'Cleaner', email: 'g2@test.com' },
        ]);
        expect(res.status).toBe(201);
        expect(res.body.data.created).toBe(2);
        expect(res.body.data.failed).toBe(3);
        const errors = res.body.data.results.filter((r) => !r.ok).map((r) => r.error);
        expect(errors).toEqual(expect.arrayContaining([
            expect.stringMatching(/name is required/i),
            expect.stringMatching(/job title is required/i),
            expect.stringMatching(/email is required/i),
        ]));
        expect(await TeamMember.countDocuments({ provider: provider._id })).toBe(2);
    });

    it('rejects an empty array, a missing array, and an over-cap batch', async () => {
        const provider = await makeProvider();
        expect((await bulk(provider, [])).status).toBe(400);
        expect((await request(app).post('/api/team/bulk').set(authHeader(provider)).send({})).status).toBe(400);
        const tooMany = Array.from({ length: 51 }, (_, i) => ({ name: `M${i}`, role: 'Cleaner', email: `m${i}@test.com` }));
        expect((await bulk(provider, tooMany)).status).toBe(400);
        expect(await TeamMember.countDocuments({ provider: provider._id })).toBe(0);
    });

    it('returns 400 with success:false when every row is invalid', async () => {
        const provider = await makeProvider();
        const res = await bulk(provider, [{ name: '', role: 'Cleaner', email: 'a@test.com' }, { role: 'Barber', email: 'b@test.com' }]);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.data.created).toBe(0);
    });

    it('ignores a spoofed provider/_id on a row — the member lands under the caller', async () => {
        const provider = await makeProvider();
        const otherBiz = await makeProvider();
        const res = await bulk(provider, [
            { name: 'Sneaky', role: 'Cleaner', email: 'sneaky@test.com', provider: String(otherBiz._id), isActive: true, bookable: true },
        ]);
        expect(res.status).toBe(201);
        expect(res.body.data.created).toBe(1);
        // The spoofed provider is dropped — the row belongs to the CALLER, not otherBiz.
        expect(await TeamMember.countDocuments({ provider: otherBiz._id })).toBe(0);
        const row = await TeamMember.findOne({ name: 'Sneaky' });
        expect(String(row.provider)).toBe(String(provider._id));
    });

    it('a staff member cannot bulk-add (owner-only route)', async () => {
        const provider = await makeProvider();
        const staff = await makeUser({ role: 'staff', staffOf: provider._id, email: 'staff@test.com' });
        const res = await bulk(staff, [{ name: 'X', role: 'Cleaner', email: 'x@test.com' }]);
        expect([401, 403]).toContain(res.status);
        expect(await TeamMember.countDocuments({ provider: provider._id })).toBe(0);
    });
});
