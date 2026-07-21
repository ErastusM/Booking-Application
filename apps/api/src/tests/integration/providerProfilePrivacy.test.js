/**
 * Finding #31 — the public provider profile must never leak the whole
 * businessProfile subdocument. Both unauthenticated routes (GET /:id and
 * GET /by-slug/:slug) funnel through buildProviderProfilePayload, which used
 * to spread businessProfile wholesale, exposing private onboarding-survey
 * answers (teamSize, locationType, currentSoftware, referralSource) and the
 * exact map-pin coordinates. These tests pin the whitelist: public fields
 * survive, private fields are stripped.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// A provider whose businessProfile carries BOTH public fields and the private
// onboarding answers + map coordinates that must not reach the public.
const fullProfile = {
    businessName: 'Vibe Barbershop',
    currency: 'NAD',
    description: 'Fresh cuts downtown',
    address: '12 Independence Ave',
    slug: 'vibe-barbershop',
    likesCount: 7,
    teamSize: '2-5',
    locationType: 'storefront',
    coordinates: { lat: -22.5609, lng: 17.0658 },
    currentSoftware: 'Fresha',
    referralSource: 'Instagram ad',
};

const PRIVATE_KEYS = ['teamSize', 'locationType', 'coordinates', 'currentSoftware', 'referralSource'];

function assertScrubbed(bp) {
    // Public fields the customer app depends on are preserved…
    expect(bp).toBeTruthy();
    expect(bp.businessName).toBe('Vibe Barbershop');
    expect(bp.description).toBe('Fresh cuts downtown');
    expect(bp.address).toBe('12 Independence Ave');
    expect(bp.slug).toBe('vibe-barbershop');
    expect(bp.currency).toBe('NAD');
    expect(bp.likesCount).toBe(7);
    // …and every private field is gone.
    PRIVATE_KEYS.forEach(k => expect(bp[k]).toBeUndefined());
}

describe('public provider profile does not leak private businessProfile fields', () => {
    it('GET /api/providers/:id strips onboarding answers and coordinates', async () => {
        const provider = await makeProvider({ businessProfile: fullProfile });
        await makeService(provider._id, { name: 'Cut', duration: 30 });

        const res = await request(app).get(`/api/providers/${provider._id}`);
        expect(res.status).toBe(200);
        assertScrubbed(res.body.data.provider.businessProfile);
    });

    it('GET /api/providers/by-slug/:slug strips the same private fields', async () => {
        const provider = await makeProvider({ businessProfile: fullProfile });
        await makeService(provider._id, { name: 'Cut', duration: 30 });

        const res = await request(app).get('/api/providers/by-slug/vibe-barbershop');
        expect(res.status).toBe(200);
        expect(res.body.data.provider._id).toBe(provider._id.toString());
        assertScrubbed(res.body.data.provider.businessProfile);
    });
});
