/**
 * Personal booking links — /b/<business>/<member>. Each team member gets a
 * shareable link that opens booking with them already chosen; the handle is
 * derived from their name, numbered for same-name colleagues, and only an
 * active member resolves.
 */
const request = require('supertest');

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const TeamMember = require('../../models/TeamMember');
const { makeUser, makeProvider, authHeader } = require('../helpers/factories');
const { assignSlugs } = require('../../utils/memberLink');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

const seed = async () => {
    const provider = await makeProvider({
        businessProfile: { businessName: 'Vido Barber', slug: 'vido-barber' },
    });
    const erastus = await TeamMember.create({ provider: provider._id, name: 'Erastus Matheus', role: 'Washer', photoUrl: 'https://res.cloudinary.com/demo/image/upload/v1/erastus.jpg' });
    const john = await TeamMember.create({ provider: provider._id, name: 'John', role: 'Barber' });
    const john2 = await TeamMember.create({ provider: provider._id, name: 'John', role: 'Barber' });
    return { provider, erastus, john, john2 };
};

describe('assignSlugs', () => {
    test('slugifies names and numbers same-name colleagues in join order', () => {
        const map = assignSlugs([
            { _id: 'a', name: 'Érastus Matheus' },
            { _id: 'b', name: 'John' },
            { _id: 'c', name: 'john' },
            { _id: 'd', name: '!!!' },
        ]);
        expect(map.get('a')).toBe('erastus-matheus');
        expect(map.get('b')).toBe('john');
        expect(map.get('c')).toBe('john-2');
        expect(map.get('d')).toBe('member');
    });
});

describe('GET /api/providers/by-slug/:slug/member/:memberSlug', () => {
    test('resolves a member link to the ids the booking flow needs', async () => {
        const { provider, erastus, john2 } = await seed();
        const res = await request(app).get('/api/providers/by-slug/vido-barber/member/erastus-matheus');
        expect(res.status).toBe(200);
        expect(String(res.body.data.providerId)).toBe(String(provider._id));
        expect(String(res.body.data.teamMemberId)).toBe(String(erastus._id));

        const second = await request(app).get('/api/providers/by-slug/vido-barber/member/john-2');
        expect(String(second.body.data.teamMemberId)).toBe(String(john2._id));
    });

    test('a paused member, unknown member or unknown business is a 404', async () => {
        const { erastus } = await seed();
        await TeamMember.updateOne({ _id: erastus._id }, { isActive: false });
        expect((await request(app).get('/api/providers/by-slug/vido-barber/member/erastus-matheus')).status).toBe(404);
        expect((await request(app).get('/api/providers/by-slug/vido-barber/member/nobody')).status).toBe(404);
        expect((await request(app).get('/api/providers/by-slug/nope/member/john')).status).toBe(404);
    });

    test('pausing a colleague never renumbers anyone else', async () => {
        const { john, john2 } = await seed();
        await TeamMember.updateOne({ _id: john._id }, { isActive: false });
        const res = await request(app).get('/api/providers/by-slug/vido-barber/member/john-2');
        expect(String(res.body.data.teamMemberId)).toBe(String(john2._id));
    });
});

describe('link handles on the member lists', () => {
    test('public staff list carries each linkSlug', async () => {
        const { provider } = await seed();
        const res = await request(app).get(`/api/providers/${provider._id}/staff`);
        const bySlug = Object.fromEntries(res.body.data.filter((m) => !m.isOwner).map((m) => [m.linkSlug, m.name]));
        expect(bySlug).toEqual({ 'erastus-matheus': 'Erastus Matheus', john: 'John', 'john-2': 'John' });
    });

    test("the owner's roster carries each linkSlug", async () => {
        const { provider } = await seed();
        const res = await request(app).get('/api/team').set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data.map((m) => m.linkSlug).sort()).toEqual(['erastus-matheus', 'john', 'john-2']);
    });

    test("a member's own profile carries their link parts", async () => {
        const { provider, erastus } = await seed();
        const login = await makeUser({ role: 'staff', staffOf: provider._id });
        await TeamMember.updateOne({ _id: erastus._id }, { user: login._id });
        const res = await request(app).get('/api/team/mine/profile').set(authHeader(login));
        expect(res.status).toBe(200);
        expect(res.body.data.businessSlug).toBe('vido-barber');
        expect(res.body.data.linkSlug).toBe('erastus-matheus');
    });
});

describe('GET /api/seo/prerender/b/:slug/:member', () => {
    test("renders the member's own card", async () => {
        await seed();
        const res = await request(app).get('/api/seo/prerender/b/vido-barber/erastus-matheus');
        expect(res.status).toBe(200);
        expect(res.text).toContain('og:title" content="Book Erastus at Vido Barber"');
        expect(res.text).toContain('erastus.jpg');
        expect(res.text).toContain('/b/vido-barber/erastus-matheus');
        expect(res.text).toContain('Washer at Vido Barber');
    });

    test('an unknown member falls back to the business card', async () => {
        await seed();
        const res = await request(app).get('/api/seo/prerender/b/vido-barber/nobody');
        expect(res.status).toBe(200);
        expect(res.text).toContain('og:title" content="Vido Barber"');
    });
});
