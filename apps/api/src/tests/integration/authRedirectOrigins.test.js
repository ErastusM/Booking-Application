/**
 * Cross-app auth redirects: a business (provider) signup must return to the
 * BUSINESS app, not the customer site. Regression for "after onboarding the
 * user is sent to the customer side and the business isn't created" — the
 * verify-email + OAuth redirects were hard-coded to the customer origin.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const User = require('../../models/User');

const CUSTOMER = 'https://www.bookplus.pro';
const BUSINESS = 'https://business.bookplus.pro';

let prevClientUrl, prevPublicOrigin, prevBusinessOrigin;
beforeAll(async () => {
    await testDb.connect();
    prevClientUrl = process.env.CLIENT_URL;
    prevPublicOrigin = process.env.PUBLIC_ORIGIN;
    prevBusinessOrigin = process.env.BUSINESS_ORIGIN;
    // Customer origin first (primary), business origin present — the real prod shape.
    process.env.CLIENT_URL = `${CUSTOMER},${BUSINESS}`;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.BUSINESS_ORIGIN;
});
afterAll(async () => {
    process.env.CLIENT_URL = prevClientUrl;
    if (prevPublicOrigin !== undefined) process.env.PUBLIC_ORIGIN = prevPublicOrigin;
    if (prevBusinessOrigin !== undefined) process.env.BUSINESS_ORIGIN = prevBusinessOrigin;
    await testDb.closeDatabase();
});
afterEach(() => testDb.clearDatabase());

const makeUnverified = (over) => User.create({
    name: 'X', email: over.email, password: 'Password1!', phone: '+15550001111',
    isVerified: false, provider: 'local',
    verificationToken: over.token, verificationTokenExpiry: new Date(Date.now() + 3600_000),
    ...over,
});

describe('GET /api/auth/verify-email redirect origin', () => {
    it('sends a verified PROVIDER back to the business app', async () => {
        await makeUnverified({ email: 'prov@x.com', token: 'tok-prov', role: 'provider', providerCategory: 'Beauty & Grooming' });
        const res = await request(app).get('/api/auth/verify-email?token=tok-prov&app=business');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(`${BUSINESS}/verify-email?status=success&role=provider`);
    });

    it('sends a verified CUSTOMER back to the customer site', async () => {
        await makeUnverified({ email: 'cust@x.com', token: 'tok-cust', role: 'customer' });
        const res = await request(app).get('/api/auth/verify-email?token=tok-cust&app=customer');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(`${CUSTOMER}/verify-email?status=success&role=customer`);
    });

    it('honours the app hint for an expired/unknown token (business)', async () => {
        const res = await request(app).get('/api/auth/verify-email?token=nope&app=business');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(`${BUSINESS}/verify-email?status=expired`);
    });

    it('defaults to the customer site when no app hint is given', async () => {
        const res = await request(app).get('/api/auth/verify-email?token=nope');
        expect(res.headers.location).toBe(`${CUSTOMER}/verify-email?status=expired`);
    });
});
