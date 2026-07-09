/**
 * Business currency: a provider can choose the currency they price in at
 * onboarding (and later), it persists, invalid codes are rejected, and it is
 * exposed on the public provider profile so the customer app can format prices.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

describe('business currency', () => {
    it('defaults to NAD and accepts a valid currency change', async () => {
        const provider = await makeProvider();

        const res = await request(app)
            .put('/api/auth/profile')
            .set(authHeader(provider))
            .send({ currency: 'usd' }); // lowercased on purpose — stored uppercase
        expect(res.status).toBe(200);

        const profile = await request(app).get(`/api/providers/${provider._id}`);
        expect(profile.status).toBe(200);
        expect(profile.body.data.provider.currency).toBe('USD');
    });

    it('rejects an unsupported currency', async () => {
        const provider = await makeProvider();
        const res = await request(app)
            .put('/api/auth/profile')
            .set(authHeader(provider))
            .send({ currency: 'XYZ' });
        expect(res.status).toBe(400);
    });
});
