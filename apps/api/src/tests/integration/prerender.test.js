/**
 * Per-provider social share cards. Crawlers (routed here by nginx) must get a
 * 200 HTML doc carrying that provider's OG/Twitter/JSON-LD tags — and a valid
 * default card (never a 404/500) when the slug or id doesn't resolve.
 */
const request = require('supertest');

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterEach(() => testDb.clearDatabase());
afterAll(() => testDb.closeDatabase());

const seedProvider = () => makeProvider({
    businessProfile: { businessName: 'Vibe Barbershop', slug: 'vibebarbershop', address: '12 Independence Ave, Windhoek' },
    avatar: 'https://res.cloudinary.com/demo/image/upload/v1/vibe.jpg',
    providerCategory: 'Beauty & Grooming',
});

describe('GET /api/seo/prerender/b/:slug', () => {
    test('renders the provider OG card', async () => {
        await seedProvider();
        const res = await request(app).get('/api/seo/prerender/b/vibebarbershop');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.text).toContain('property="og:title" content="Vibe Barbershop"');
        expect(res.text).toContain('og:image" content="https://res.cloudinary.com/demo/image/upload/v1/vibe.jpg"');
        expect(res.text).toContain('/b/vibebarbershop');
        expect(res.text).toContain('application/ld+json');
        expect(res.text).toContain('"@type":"LocalBusiness"');
    });

    test('unknown slug returns a valid default card, not a 404', async () => {
        const res = await request(app).get('/api/seo/prerender/b/does-not-exist');
        expect(res.status).toBe(200);
        expect(res.text).toContain('og:site_name" content="Bookplus"');
    });
});

describe('GET /api/seo/prerender/providers/:id', () => {
    test('renders by id with the slug canonical URL', async () => {
        const p = await seedProvider();
        const res = await request(app).get(`/api/seo/prerender/providers/${p._id}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain('/b/vibebarbershop'); // canonical prefers the pretty slug
        expect(res.text).toContain('og:title" content="Vibe Barbershop"');
    });

    test('a malformed id (CastError) still returns the default card', async () => {
        const res = await request(app).get('/api/seo/prerender/providers/not-an-objectid');
        expect(res.status).toBe(200);
        expect(res.text).toContain('og:site_name" content="Bookplus"');
    });
});
