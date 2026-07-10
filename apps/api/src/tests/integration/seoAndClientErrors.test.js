/**
 * Production-hardening endpoints: the SEO sitemap/robots.txt and the frontend
 * crash-reporting sink.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeUser } = require('../helpers/factories');
const { primaryOrigin } = require('../../utils/origins');

// The route builds absolute URLs from primaryOrigin() (falling back to the prod
// origin) — mirror that here so the assertions hold in any env's CLIENT_URL.
const BASE = (primaryOrigin() || 'https://www.bookplus.pro').replace(/\/$/, '');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('GET /api/seo/sitemap.xml', () => {
    it('returns valid XML listing static pages and each provider booking page', async () => {
        await makeProvider({ businessProfile: { businessName: 'Slug Salon', slug: 'slug-salon' } });

        const res = await request(app).get('/api/seo/sitemap.xml');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/xml/);
        expect(res.text).toContain('<urlset');
        // Static marketplace home page
        expect(res.text).toContain(`<loc>${BASE}/</loc>`);
        // The provider's public /b/:slug page
        expect(res.text).toContain(`<loc>${BASE}/b/slug-salon</loc>`);
    });

    it('omits providers that have no slug yet', async () => {
        await makeProvider({ businessProfile: { businessName: 'No Slug Co' } }); // slug undefined
        const res = await request(app).get('/api/seo/sitemap.xml');
        expect(res.status).toBe(200);
        expect(res.text).not.toContain('/b/undefined');
        // still contains the static home entry
        expect(res.text).toContain(`<loc>${BASE}/</loc>`);
    });
});

describe('GET /api/seo/robots.txt', () => {
    it('allows crawlers and points at the sitemap', async () => {
        const res = await request(app).get('/api/seo/robots.txt');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/plain/);
        expect(res.text).toContain('User-agent: *');
        expect(res.text).toContain(`Sitemap: ${BASE}/sitemap.xml`);
        // auth-only surfaces are kept out of the index
        expect(res.text).toContain('Disallow: /wallet');
    });
});

describe('POST /api/client-errors', () => {
    it('accepts a well-formed client error and acks 204', async () => {
        const res = await request(app).post('/api/client-errors').send({
            app: 'customer',
            type: 'unhandledrejection',
            message: 'Boom in checkout',
            stack: 'Error: Boom\n  at x (a.js:1:1)',
            url: 'https://www.bookplus.pro/book-appointment',
        });
        expect(res.status).toBe(204);
    });

    it('never rejects on a missing/garbage body', async () => {
        const res = await request(app).post('/api/client-errors').send({});
        expect(res.status).toBe(204);
    });

    it('is reachable without authentication (browsers have no token)', async () => {
        const customer = await makeUser();
        expect(customer).toBeTruthy(); // sanity: db is up
        const res = await request(app).post('/api/client-errors').send({ message: 'anon error' });
        expect(res.status).toBe(204);
    });
});
