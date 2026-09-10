/**
 * Permission tiers — Phase 3c: team:manage opens ROSTER management to a High
 * staff member — but NOT the crown-jewel routes. The self-escalation guards are
 * the point of this suite:
 *   - setTeamMemberPermissions (mints staffTier/staffPermissions) stays OWNER-ONLY
 *   - inviteTeamMember (mints privileged accounts) stays OWNER-ONLY
 *   - updateTeamMember strips owner-only HR (employment/notes) for a staff actor
 *   - every wired route scopes to the employer (no cross-tenant management)
 * so a High manager can add/update/archive colleagues but can NEVER grant or
 * spread the High tier, nor read/write a colleague's HR record.
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

let seq = 0;
const makeStaff = async (provider, tier) => {
    seq += 1;
    const login = await makeUser({ role: 'staff', staffOf: provider._id, email: `staff-${tier}-${seq}@test.com`, staffTier: tier });
    const row = await TeamMember.create({ provider: provider._id, name: `Staff ${tier} ${seq}`, role: 'Manager', user: login._id });
    return { login, row };
};

describe('team:manage — wired operational routes', () => {
    it('a High staff member adds a member under their EMPLOYER', async () => {
        const provider = await makeProvider();
        const { login: high } = await makeStaff(provider, 'high');
        const res = await request(app).post('/api/team').set(authHeader(high)).send({ name: 'New Hire' });
        expect(res.status).toBe(201);
        expect(String(res.body.data.provider)).toBe(String(provider._id));
    });

    it('a High staff member lists + archives a colleague of their business', async () => {
        const provider = await makeProvider();
        const { login: high } = await makeStaff(provider, 'high');
        const target = await TeamMember.create({ provider: provider._id, name: 'Colleague' });

        const list = await request(app).get('/api/team').set(authHeader(high));
        expect(list.status).toBe(200);

        const del = await request(app).delete(`/api/team/${target._id}`).set(authHeader(high));
        expect(del.status).toBe(200);
        expect((await TeamMember.findById(target._id)).isActive).toBe(false);
    });

    it('a Medium staff member cannot manage the team (no team:manage)', async () => {
        const provider = await makeProvider();
        const { login: medium } = await makeStaff(provider, 'medium');
        const res = await request(app).post('/api/team').set(authHeader(medium)).send({ name: 'X' });
        expect(res.status).toBe(403);
    });

    it("cannot manage another business's member (cross-tenant)", async () => {
        const businessA = await makeProvider();
        const memberOfA = await TeamMember.create({ provider: businessA._id, name: 'A-member' });
        const businessB = await makeProvider();
        const { login: highOfB } = await makeStaff(businessB, 'high');

        const res = await request(app).delete(`/api/team/${memberOfA._id}`).set(authHeader(highOfB));
        expect(res.status).toBe(404); // scoped to B → A's member is invisible
    });
});

describe('team:manage — CROWN JEWELS stay owner-only (no self-escalation)', () => {
    it('a High staff member CANNOT set anyone\'s permissions/tier (route is owner-only)', async () => {
        const provider = await makeProvider();
        const { login: high, row: highRow } = await makeStaff(provider, 'high');
        const colleague = await TeamMember.create({ provider: provider._id, name: 'Colleague' });

        // Cannot grant a colleague the High tier…
        const grantOther = await request(app)
            .put(`/api/team/${colleague._id}/permissions`)
            .set(authHeader(high))
            .send({ tier: 'high' });
        expect(grantOther.status).toBe(403);

        // …and cannot re-grant/keep their OWN tier or add caps.
        const grantSelf = await request(app)
            .put(`/api/team/${highRow._id}/permissions`)
            .set(authHeader(high))
            .send({ tier: 'high', permissions: ['team:manage', 'settings:edit'] });
        expect(grantSelf.status).toBe(403);
    });

    it('a High staff member CANNOT invite (mint a privileged account)', async () => {
        const provider = await makeProvider();
        const { login: high } = await makeStaff(provider, 'high');
        const member = await TeamMember.create({ provider: provider._id, name: 'Invitee', email: 'invitee@test.com' });
        const res = await request(app)
            .post(`/api/team/${member._id}/invite`)
            .set(authHeader(high))
            .send({ tier: 'high' });
        expect(res.status).toBe(403);
    });

    it('the owner can still set permissions and invite (unchanged)', async () => {
        const provider = await makeProvider();
        const member = await TeamMember.create({ provider: provider._id, name: 'M', email: 'm@test.com' });
        // Link a login so setPermissions has a user to write to.
        const login = await makeUser({ role: 'staff', staffOf: provider._id, email: 'mlogin@test.com' });
        await TeamMember.updateOne({ _id: member._id }, { $set: { user: login._id } });

        const perm = await request(app)
            .put(`/api/team/${member._id}/permissions`)
            .set(authHeader(provider))
            .send({ tier: 'high' });
        expect(perm.status).toBe(200);
    });
});

describe('team:manage — owner-only HR (employment/notes) is neither written nor read by a staff actor', () => {
    it('a High staff member can edit public fields but NOT employment/notes, and the response hides them', async () => {
        const provider = await makeProvider();
        const { login: high } = await makeStaff(provider, 'high');
        const target = await TeamMember.create({
            provider: provider._id, name: 'Colleague',
            notes: 'owner note', employment: { type: 'Employed' },
        });

        const res = await request(app)
            .put(`/api/team/${target._id}`)
            .set(authHeader(high))
            .send({ bio: 'public bio', notes: 'staff tried to read/write HR', employment: { type: 'Owner' } });
        expect(res.status).toBe(200);

        const saved = await TeamMember.findById(target._id);
        expect(saved.bio).toBe('public bio');        // public field changed
        expect(saved.notes).toBe('owner note');       // HR untouched in the DB
        expect(saved.employment.type).toBe('Employed');

        // …and the RESPONSE must not echo the stored HR back to the staff actor.
        expect(res.body.data.bio).toBe('public bio');
        expect(res.body.data.notes).toBeUndefined();
        expect(res.body.data.employment).toBeUndefined();
    });

    it('getMyTeam does not leak a colleague\'s employment/notes to a High staff member', async () => {
        const provider = await makeProvider();
        const { login: high } = await makeStaff(provider, 'high');
        await TeamMember.create({
            provider: provider._id, name: 'Colleague',
            notes: 'confidential HR note', employment: { type: 'Employed', startDate: new Date('2020-01-01') },
        });

        const res = await request(app).get('/api/team').set(authHeader(high));
        expect(res.status).toBe(200);
        for (const m of res.body.data) {
            expect(m.notes).toBeUndefined();
            expect(m.employment).toBeUndefined();
        }
    });

    it('the owner still sees employment/notes on the roster', async () => {
        const provider = await makeProvider();
        await TeamMember.create({
            provider: provider._id, name: 'Colleague',
            notes: 'owner note', employment: { type: 'Employed' },
        });

        const res = await request(app).get('/api/team').set(authHeader(provider));
        expect(res.status).toBe(200);
        const row = res.body.data.find((m) => m.name === 'Colleague');
        expect(row.notes).toBe('owner note');            // owner keeps full visibility
        expect(row.employment.type).toBe('Employed');
    });
});
