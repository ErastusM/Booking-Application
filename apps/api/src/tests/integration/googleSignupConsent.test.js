/**
 * Age and Terms at sign-up (compliance audit points 4 and 15).
 *   - Email sign-up: the API refuses unless the Terms/Privacy box AND the
 *     minimum-age box were ticked, and records both.
 *   - First-time "Continue with Google": no account exists until the person has
 *     seen the Terms and Privacy Policy and confirmed their age on the "Finish
 *     signing up" step — Google alone no longer creates (or consents for) it.
 */
const request = require('supertest');
const crypto = require('crypto');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const User = require('../../models/User');
const PendingSignup = require('../../models/PendingSignup');
const emailService = require('../../utils/emailService');
const { MIN_SIGNUP_AGE } = require('../../constants/consent');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

describe('email sign-up', () => {
    const body = (extra) => ({ name: 'Ndapewa Shilongo', email: 'nd@example.com', password: 'Password1!', phone: '+264811234567', role: 'customer', ...extra });

    it(`refuses without the ${MIN_SIGNUP_AGE}+ confirmation, and without the Terms`, async () => {
        const noAge = await request(app).post('/api/auth/register').send(body({ termsAccepted: true }));
        expect(noAge.status).toBe(400);
        expect(noAge.body.code).toBe('age_required');
        expect(noAge.body.message).toContain(String(MIN_SIGNUP_AGE));
        const noTerms = await request(app).post('/api/auth/register').send(body({ ageConfirmed: true }));
        expect(noTerms.status).toBe(400);
        expect(noTerms.body.code).toBe('terms_required');
        const truthyString = await request(app).post('/api/auth/register').send(body({ termsAccepted: 'yes', ageConfirmed: 'yes' }));
        expect(truthyString.status).toBe(400);
        expect(await User.countDocuments({})).toBe(0);
    });

    it('an app cached from before these boxes existed gets a "refresh the page" message, same code', async () => {
        const res = await request(app).post('/api/auth/register').send(body({}));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('terms_required');
        expect(res.body.message).toMatch(/refresh the page/i);
    });

    it('records when Terms and age were accepted', async () => {
        const res = await request(app).post('/api/auth/register').send(body({ termsAccepted: true, ageConfirmed: true }));
        expect(res.status).toBe(201);
        const u = await User.findOne({ email: 'nd@example.com' });
        expect(u.consentedAt).toBeInstanceOf(Date);
        expect(u.ageConfirmedAt).toBeInstanceOf(Date);
        expect(u.consentLog.map((c) => c.kind)).toEqual(expect.arrayContaining(['terms_privacy', 'age_confirmed']));
    });
});

describe('first-time Google sign-in → "Finish signing up"', () => {
    const park = async (role = 'customer', email = 'gnew@example.com') => {
        const code = crypto.randomBytes(32).toString('hex');
        await PendingSignup.create({
            codeHash: crypto.createHash('sha256').update(code).digest('hex'),
            googleId: 'google-777', email, name: 'Gina New', avatar: 'http://img/a.png', role,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });
        return code;
    };

    it('shows who is signing up without creating anything', async () => {
        const code = await park();
        const res = await request(app).post('/api/auth/google/pending').send({ code });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ name: 'Gina New', email: 'gnew@example.com', role: 'customer', minAge: MIN_SIGNUP_AGE });
        expect(await User.countDocuments({})).toBe(0);
    });

    it('refuses to create the account until Terms and age are both confirmed', async () => {
        const code = await park();
        for (const extra of [{}, { termsAccepted: true }, { ageConfirmed: true }]) {
            const res = await request(app).post('/api/auth/google/complete').send({ code, ...extra });
            expect(res.status).toBe(400);
        }
        expect(await User.countDocuments({})).toBe(0);
    });

    it('creates the account, records the consents, signs them in, and burns the code', async () => {
        const code = await park();
        const res = await request(app).post('/api/auth/google/complete').send({ code, termsAccepted: true, ageConfirmed: true, marketingOptIn: false });
        expect(res.status).toBe(201);
        expect(res.body.data.token).toBeTruthy();
        expect(res.body.data.user).toMatchObject({ email: 'gnew@example.com', role: 'customer', phone: 'pending' });
        const u = await User.findOne({ email: 'gnew@example.com' });
        expect(u).toMatchObject({ googleId: 'google-777', isVerified: true, provider: 'google' });
        expect(u.consentedAt).toBeInstanceOf(Date);
        expect(u.ageConfirmedAt).toBeInstanceOf(Date);
        expect(u.marketingEmails.optIn).toBe(false);
        expect(emailService.sendWelcomeEmail).toHaveBeenCalledTimes(1);
        expect(await PendingSignup.countDocuments({})).toBe(0);
        const again = await request(app).post('/api/auth/google/complete').send({ code, termsAccepted: true, ageConfirmed: true });
        expect(again.status).toBe(400);
        expect(again.body.code).toBe('signup_expired');
    });

    it('a business sign-up creates a provider account', async () => {
        const code = await park('provider', 'biz@example.com');
        const res = await request(app).post('/api/auth/google/complete').send({ code, termsAccepted: true, ageConfirmed: true, marketingOptIn: true });
        expect(res.status).toBe(201);
        const u = await User.findOne({ email: 'biz@example.com' });
        expect(u.role).toBe('provider');
        expect(u.marketingEmails.optIn).toBe(false); // marketing email is a customer thing
    });

    it('an expired or unknown code gets a clear "start again"', async () => {
        const code = crypto.randomBytes(32).toString('hex');
        const res = await request(app).post('/api/auth/google/complete').send({ code, termsAccepted: true, ageConfirmed: true });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('signup_expired');
    });

    it('the Google callback sends a first-timer to the finish step, not straight into an account', async () => {
        const passport = require('../../config/passport');
        const strategy = passport._strategy('google');
        const orig = strategy.authenticate;
        // Stand in for Google: the verify callback has already parked the profile.
        strategy.authenticate = function () {
            PendingSignup.create({ googleId: 'g-cb', email: 'cb@example.com', name: 'CB', role: 'customer', expiresAt: new Date(Date.now() + 600e3) })
                .then((p) => this.success({ pendingSignup: true, id: p._id, role: 'customer' }));
        };
        try {
            const { buildState, cookieHeader } = require('../../utils/oauthState');
            const { state, nonce } = buildState('customer');
            const cookie = cookieHeader(nonce).split(';')[0];
            const res = await request(app).get(`/api/auth/google/callback?state=${encodeURIComponent(state)}&code=x`).set('Cookie', cookie);
            expect(res.status).toBe(302);
            expect(res.headers.location).toMatch(/\/auth\/callback\?signup=[0-9a-f]{64}$/);
            expect(await User.countDocuments({ email: 'cb@example.com' })).toBe(0);
            const code = res.headers.location.split('signup=')[1];
            expect((await request(app).post('/api/auth/google/pending').send({ code })).body.data.email).toBe('cb@example.com');
        } finally {
            strategy.authenticate = orig;
        }
    });
});
