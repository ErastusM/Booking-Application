/**
 * Account switcher endpoints — the "Your accounts" section in both navbars.
 *
 *   GET  /auth/sibling            does the signed-in user hold an account on the
 *                                 other side, and can we carry them across?
 *   POST /auth/switch-side        hand them to that existing account, signed in —
 *                                 only when it is provably the same identity.
 *   POST /auth/add-customer-account  a business owner adds a personal customer
 *                                 account (mirror of become-provider).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, authHeader } = require('../helpers/factories');
const User = require('../../models/User');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const EMAIL = 'dual@example.com';

// bcrypt salts every hash, so two accounts that register the same plaintext get
// DIFFERENT stored hashes and are NOT "same identity". A real same-identity pair
// is a clone: become-provider / add-customer copy the source's stored hash onto
// the new document. This helper reproduces that so sameIdentity's hash branch is
// genuinely exercised (a plaintext-only setup would wrongly assert the guard).
const cloneHash = async (fromId, toId) => {
    const src = await User.findById(fromId).select('+password');
    await User.updateOne({ _id: toId }, { $set: { password: src.password } });
};

describe('GET /auth/sibling', () => {
    it('reports a business sibling with the SAME identity (cloned hash) as carryable', async () => {
        const customer = await makeUser({ email: EMAIL, password: 'Password1!', isVerified: true });
        const business = await makeProvider({ email: EMAIL, password: 'Password1!', isVerified: true });
        await cloneHash(customer._id, business._id);
        const res = await request(app).get('/api/auth/sibling').set(authHeader(customer));
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ accountType: 'business', sameCredentials: true });
    });

    it('reports a business sibling with independent credentials as not carryable', async () => {
        // Different plaintext → different hashes anyway, but be explicit.
        const customer = await makeUser({ email: EMAIL, password: 'Password1!', isVerified: true });
        await makeProvider({ email: EMAIL, password: 'Different1!', isVerified: true });
        const res = await request(app).get('/api/auth/sibling').set(authHeader(customer));
        expect(res.body.data).toMatchObject({ accountType: 'business', sameCredentials: false });
    });

    it('treats a shared Google identity as carryable even with no password', async () => {
        const customer = await makeUser({ email: EMAIL, password: undefined, isVerified: true });
        const business = await makeProvider({ email: EMAIL, isVerified: true });
        await User.updateMany({ email: EMAIL }, { $set: { googleId: 'g-1' }, $unset: { password: '' } });
        void business;
        const res = await request(app).get('/api/auth/sibling').set(authHeader(customer));
        expect(res.body.data).toMatchObject({ accountType: 'business', sameCredentials: true });
    });

    it('returns null for a single account', async () => {
        const customer = await makeUser({ email: EMAIL, isVerified: true });
        const res = await request(app).get('/api/auth/sibling').set(authHeader(customer));
        expect(res.body.data).toBeNull();
    });

    it('ignores an admin-suspended sibling', async () => {
        const customer = await makeUser({ email: EMAIL, password: 'Password1!', isVerified: true });
        await makeProvider({ email: EMAIL, password: 'Password1!', isVerified: true, isActive: false });
        const res = await request(app).get('/api/auth/sibling').set(authHeader(customer));
        expect(res.body.data).toBeNull();
    });
});

describe('POST /auth/switch-side', () => {
    it('mints a working hand-off code for a same-identity sibling', async () => {
        const customer = await makeUser({ email: EMAIL, password: 'Password1!', isVerified: true });
        const business = await makeProvider({ email: EMAIL, password: 'Password1!', isVerified: true });
        await cloneHash(customer._id, business._id);

        const res = await request(app).post('/api/auth/switch-side').set(authHeader(customer));
        expect(res.status).toBe(200);
        expect(res.body.data.accountType).toBe('business');
        const code = res.body.data.handoffCode;
        expect(code).toHaveLength(64);

        const exchanged = await request(app).post('/api/auth/exchange-code').send({ code });
        expect(exchanged.status).toBe(200);
        expect(exchanged.body.data.user.role).toBe('provider');
    });

    it('refuses (409) a sibling with independent credentials — sign-in required', async () => {
        const customer = await makeUser({ email: EMAIL, password: 'Password1!', isVerified: true });
        await makeProvider({ email: EMAIL, password: 'Different1!', isVerified: true });
        const res = await request(app).post('/api/auth/switch-side').set(authHeader(customer));
        expect(res.status).toBe(409);
        expect(res.body.message).toBe('sign_in_required');
        expect(res.body.accountType).toBe('business');
    });

    it('404s when there is no account on the other side', async () => {
        const customer = await makeUser({ email: EMAIL, isVerified: true });
        const res = await request(app).post('/api/auth/switch-side').set(authHeader(customer));
        expect(res.status).toBe(404);
    });
});

describe('POST /auth/add-customer-account', () => {
    it('creates a customer account and lands them on it via a one-time code', async () => {
        const owner = await makeProvider({ email: EMAIL, password: 'Password1!', isVerified: true });

        const res = await request(app).post('/api/auth/add-customer-account').set(authHeader(owner));
        expect(res.status).toBe(200);
        const code = res.body.data.handoffCode;

        const customer = await User.findOne({ email: EMAIL, role: 'customer' }).select('+password');
        expect(customer).toBeTruthy();
        expect(String(customer._id)).not.toBe(String(owner._id));
        // Shares the owner's password so the switch is instant next time.
        expect(customer.password).toBeTruthy();

        const exchanged = await request(app).post('/api/auth/exchange-code').send({ code });
        expect(exchanged.status).toBe(200);
        expect(exchanged.body.data.user.role).toBe('customer');
    });

    it('copies the Google identity for a Google-only owner (no password)', async () => {
        const owner = await makeProvider({ email: EMAIL, isVerified: true });
        await User.updateOne({ _id: owner._id }, { $set: { googleId: 'g-owner' }, $unset: { password: '' } });

        const res = await request(app).post('/api/auth/add-customer-account').set(authHeader(owner));
        expect(res.status).toBe(200);
        const customer = await User.findOne({ email: EMAIL, role: 'customer' }).select('+password');
        expect(customer.googleId).toBe('g-owner');
        expect(customer.password).toBeFalsy();
    });

    it('refuses when a customer account already exists', async () => {
        const owner = await makeProvider({ email: EMAIL, isVerified: true });
        await makeUser({ email: EMAIL, isVerified: true });
        const res = await request(app).post('/api/auth/add-customer-account').set(authHeader(owner));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already exists/i);
    });

    it('refuses a caller who is already a customer', async () => {
        const customer = await makeUser({ email: EMAIL, isVerified: true });
        const res = await request(app).post('/api/auth/add-customer-account').set(authHeader(customer));
        expect(res.status).toBe(400);
    });
});

// The switcher must not become an enumeration oracle. login() only reveals an
// other-side account to someone who owns the email (verified or social);
// registration does not verify the inbox, so an attacker could register an
// unverified account on a victim's email. getSibling/switch-side apply the same
// gate — except for a same-identity sibling, which the caller demonstrably made.
describe('anti-enumeration gate', () => {
    it('does not reveal an independent sibling to an UNVERIFIED caller', async () => {
        const attacker = await makeUser({ email: EMAIL, password: 'Password1!', isVerified: false });
        await makeProvider({ email: EMAIL, password: 'Different1!', isVerified: true });
        const res = await request(app).get('/api/auth/sibling').set(authHeader(attacker));
        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();
    });

    it('switch-side gives an unverified non-owner the same 404 as "no sibling" (no oracle)', async () => {
        const attacker = await makeUser({ email: EMAIL, password: 'Password1!', isVerified: false });
        await makeProvider({ email: EMAIL, password: 'Different1!', isVerified: true });
        const res = await request(app).post('/api/auth/switch-side').set(authHeader(attacker));
        expect(res.status).toBe(404);
    });

    it('STILL reveals a same-identity sibling to an unverified caller (they made it)', async () => {
        const customer = await makeUser({ email: EMAIL, password: 'Password1!', isVerified: false });
        const business = await makeProvider({ email: EMAIL, password: 'Password1!', isVerified: true });
        await cloneHash(customer._id, business._id);
        const res = await request(app).get('/api/auth/sibling').set(authHeader(customer));
        expect(res.body.data).toMatchObject({ accountType: 'business', sameCredentials: true });
    });
});

describe('switching into a self-deactivated sibling reactivates it', () => {
    it('the exchanged session is active, not a dead "suspended" one', async () => {
        const customer = await makeUser({ email: EMAIL, password: 'Password1!', isVerified: true });
        const business = await makeProvider({ email: EMAIL, password: 'Password1!', isVerified: true });
        await cloneHash(customer._id, business._id);
        // The business side is self-deactivated (isActive false WITH deactivatedAt).
        await User.updateOne({ _id: business._id }, { $set: { isActive: false, deactivatedAt: new Date() } });

        const sw = await request(app).post('/api/auth/switch-side').set(authHeader(customer));
        expect(sw.status).toBe(200);
        const exchanged = await request(app).post('/api/auth/exchange-code').send({ code: sw.body.data.handoffCode });
        expect(exchanged.status).toBe(200);
        const after = await User.findById(business._id);
        expect(after.isActive).toBe(true);
        expect(after.deactivatedAt).toBeFalsy();
    });

    it('an admin-suspended sibling is never offered (excluded upstream)', async () => {
        const customer = await makeUser({ email: EMAIL, password: 'Password1!', isVerified: true });
        const business = await makeProvider({ email: EMAIL, password: 'Password1!', isVerified: true });
        await cloneHash(customer._id, business._id);
        await User.updateOne({ _id: business._id }, { $set: { isActive: false }, $unset: { deactivatedAt: '' } });
        const res = await request(app).post('/api/auth/switch-side').set(authHeader(customer));
        expect(res.status).toBe(404);
    });
});
