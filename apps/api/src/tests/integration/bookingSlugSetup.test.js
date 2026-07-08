/**
 * PR A foundation for business onboarding: the booking-link slug system, map
 * coordinates on the profile, and the dashboard setup-status endpoint.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService, makeUser, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const Availability = require('../../models/Availability');
const { slugify, generateUniqueSlug } = require('../../utils/slug');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('slugify', () => {
    it('produces URL-safe handles and strips accents', () => {
        expect(slugify('The Vibe Barbershop!')).toBe('the-vibe-barbershop');
        expect(slugify('  Café  &  Cuts  ')).toBe('cafe-cuts');
        expect(slugify('!!!')).toBe('');
    });
});

describe('POST /api/auth/booking-slug', () => {
    it('generates a slug from the business name and is idempotent', async () => {
        const provider = await makeProvider({ businessProfile: { businessName: 'The Vibe Barbershop' } });

        const first = await request(app).post('/api/auth/booking-slug').set(authHeader(provider));
        expect(first.status).toBe(200);
        expect(first.body.data.slug).toBe('the-vibe-barbershop');

        // Repeat call returns the same slug (no new one minted).
        const second = await request(app).post('/api/auth/booking-slug').set(authHeader(provider));
        expect(second.body.data.slug).toBe('the-vibe-barbershop');
    });

    it('suffixes on collision so every business gets a unique link', async () => {
        const a = await makeProvider({ businessProfile: { businessName: 'The Vibe' } });
        const b = await makeProvider({ businessProfile: { businessName: 'The Vibe' } });

        const slugA = (await request(app).post('/api/auth/booking-slug').set(authHeader(a))).body.data.slug;
        const slugB = (await request(app).post('/api/auth/booking-slug').set(authHeader(b))).body.data.slug;

        expect(slugA).toBe('the-vibe');
        expect(slugB).toBe('the-vibe-2');
        expect(slugA).not.toBe(slugB);
    });

    it('rejects non-providers (403)', async () => {
        const customer = await makeUser();
        const res = await request(app).post('/api/auth/booking-slug').set(authHeader(customer));
        expect(res.status).toBe(403);
    });
});

describe('generateUniqueSlug util falls back for blank names', () => {
    it('never returns an empty slug', async () => {
        const slug = await generateUniqueSlug('!!!');
        expect(slug).toMatch(/^business-[a-z0-9]+$/);
    });
});

describe('GET /api/providers/by-slug/:slug', () => {
    it('resolves a slug to the same profile payload as /:id', async () => {
        const provider = await makeProvider({ businessProfile: { businessName: 'Slug Salon', slug: 'slug-salon' } });
        await makeService(provider._id, { name: 'Cut', duration: 30 });

        const res = await request(app).get('/api/providers/by-slug/slug-salon');
        expect(res.status).toBe(200);
        expect(res.body.data.provider._id).toBe(provider._id.toString());
        expect(res.body.data.provider.serviceCount).toBe(1);
    });

    it('is case-insensitive on the slug', async () => {
        await makeProvider({ businessProfile: { businessName: 'Slug Salon', slug: 'slug-salon' } });
        const res = await request(app).get('/api/providers/by-slug/SLUG-SALON');
        expect(res.status).toBe(200);
    });

    it('404s an unknown slug', async () => {
        const res = await request(app).get('/api/providers/by-slug/nope-nope');
        expect(res.status).toBe(404);
    });
});

describe('PUT /api/auth/profile — map coordinates', () => {
    it('persists valid coordinates', async () => {
        const provider = await makeProvider();
        const res = await request(app)
            .put('/api/auth/profile')
            .set(authHeader(provider))
            .send({ coordinates: { lat: -22.5609, lng: 17.0658 } });
        expect(res.status).toBe(200);

        const saved = await User.findById(provider._id).select('businessProfile');
        expect(saved.businessProfile.coordinates.lat).toBeCloseTo(-22.5609);
        expect(saved.businessProfile.coordinates.lng).toBeCloseTo(17.0658);
    });

    it('rejects out-of-range coordinates (400)', async () => {
        const provider = await makeProvider();
        const res = await request(app)
            .put('/api/auth/profile')
            .set(authHeader(provider))
            .send({ coordinates: { lat: 999, lng: 0 } });
        expect(res.status).toBe(400);
    });
});

describe('GET /api/providers/me/setup-status', () => {
    it('reports every step incomplete for a fresh provider', async () => {
        const provider = await makeProvider();
        const res = await request(app).get('/api/providers/me/setup-status').set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ address: false, hours: false, services: false, photos: false, complete: false });
    });

    it('flips each flag as the provider fills things in', async () => {
        const provider = await makeProvider({
            avatar: 'https://cdn/x.jpg',
            businessProfile: { businessName: 'X', address: '12 Main St', slug: 'x-biz' },
        });
        await makeService(provider._id, { duration: 30 });
        await Availability.create({
            provider: provider._id,
            schedule: { monday: { enabled: true, slots: [{ start: '09:00', end: '17:00' }] } },
        });

        const res = await request(app).get('/api/providers/me/setup-status').set(authHeader(provider));
        expect(res.body.data).toMatchObject({
            address: true, hours: true, services: true, photos: true, slug: true, complete: true,
        });
    });
});
