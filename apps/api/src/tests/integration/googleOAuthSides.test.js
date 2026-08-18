/**
 * Google sign-in must resolve to an EXISTING account on either side before ever
 * creating one. It used to scope every lookup to the side the button was on, so
 * a business owner tapping "Continue with Google" on the customer site sailed
 * past their real account and was silently minted a brand-new empty CUSTOMER
 * account (and vice versa) — one human forked into two. These drive the
 * strategy's verify callback directly (no real Google round-trip needed).
 */
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider } = require('../helpers/factories');
const User = require('../../models/User');

jest.mock('../../utils/emailService', () => ({
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-client-secret';

const passport = require('../../config/passport');
const { buildState } = require('../../utils/oauthState');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

// Call the registered strategy's verify callback the way passport would.
const signInWithGoogle = (role, profile) => new Promise((resolve, reject) => {
    const { state } = buildState(role);
    const verify = passport._strategy('google')._verify;
    verify({ query: { state } }, 'access', 'refresh', profile, (err, user) => (
        err ? reject(err) : resolve(user)
    ));
});

const profileFor = (email, { id = 'google-123', verified = true } = {}) => ({
    id,
    displayName: 'G Tester',
    emails: [{ value: email, verified }],
    photos: [{ value: 'http://img/avatar.png' }],
    _json: { email_verified: verified },
});

const EMAIL = 'owner@example.com';

describe('Google sign-in resolves existing accounts across sides', () => {
    it('a business account already linked to this Google id wins over creating a customer', async () => {
        const provider = await makeProvider({ email: EMAIL, googleId: 'google-123' });

        const user = await signInWithGoogle('customer', profileFor(EMAIL));

        expect(user._id.toString()).toBe(provider._id.toString());
        expect(user.role).toBe('provider');
        expect(await User.countDocuments({ email: EMAIL })).toBe(1); // no fork
    });

    it('a verified business LOCAL account gets linked instead of forking a customer', async () => {
        const provider = await makeProvider({ email: EMAIL, isVerified: true });

        const user = await signInWithGoogle('customer', profileFor(EMAIL));

        expect(user._id.toString()).toBe(provider._id.toString());
        expect(user.googleId).toBe('google-123');
        expect(await User.countDocuments({ email: EMAIL })).toBe(1);
    });

    it('mirror image: a customer account wins over creating a provider', async () => {
        const customer = await makeUser({ email: EMAIL, googleId: 'google-123' });

        const user = await signInWithGoogle('provider', profileFor(EMAIL));

        expect(user._id.toString()).toBe(customer._id.toString());
        expect(user.role).toBe('customer');
        expect(await User.countDocuments({ email: EMAIL })).toBe(1);
    });

    it('when BOTH sides exist, the side the button was on wins', async () => {
        const customer = await makeUser({ email: EMAIL, googleId: 'google-123' });
        const provider = await makeProvider({ email: EMAIL, googleId: 'google-123' });

        expect((await signInWithGoogle('customer', profileFor(EMAIL)))._id.toString())
            .toBe(customer._id.toString());
        expect((await signInWithGoogle('provider', profileFor(EMAIL)))._id.toString())
            .toBe(provider._id.toString());
    });

    it('a genuinely new person is still created on the requested side', async () => {
        const user = await signInWithGoogle('customer', profileFor('new@example.com'));
        expect(user.role).toBe('customer');
        expect(user.isVerified).toBe(true);
    });

    it('an unverified Google email never links to an existing account', async () => {
        await makeProvider({ email: EMAIL, isVerified: true });
        const user = await signInWithGoogle('customer', profileFor(EMAIL, { verified: false }));
        expect(user).toBe(false); // refused — cannot prove mailbox ownership
        expect(await User.countDocuments({ email: EMAIL })).toBe(1);
    });
});
