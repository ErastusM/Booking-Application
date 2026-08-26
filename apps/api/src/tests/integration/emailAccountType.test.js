/**
 * Email + account-type auth: one email may hold a customer account AND a
 * business account; login/refresh are scoped per app so each side only
 * authenticates its own account type.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider } = require('../helpers/factories');
const User = require('../../models/User');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
    sendAppointmentConfirmed: jest.fn().mockResolvedValue(true),
    sendAppointmentCancelled: jest.fn().mockResolvedValue(true),
    sendAppointmentCompleted: jest.fn().mockResolvedValue(true),
    sendAppointmentRescheduled: jest.fn().mockResolvedValue(true),
    sendRebookingPrompt: jest.fn().mockResolvedValue(true),
}));
const { sendPasswordResetEmail } = require('../../utils/emailService');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

const EMAIL = 'dual@example.com';
const CUSTOMER_PW = 'CustomerPass1!';
const BUSINESS_PW = 'BusinessPass1!';

const registerPayload = (overrides = {}) => ({
    name: 'Dual User',
    email: EMAIL,
    password: CUSTOMER_PW,
    phone: '+15550004321',
    role: 'customer',
    ...overrides,
});

const makeDualAccounts = async () => {
    const customer = await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
    const business = await makeProvider({ email: EMAIL, password: BUSINESS_PW, isVerified: true });
    return { customer, business };
};

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────
describe('registration with an email used by the other account type', () => {
    it('allows a business (provider) account on an email that already has a customer account', async () => {
        const first = await request(app).post('/api/auth/register').send(registerPayload());
        expect(first.status).toBe(201);

        const second = await request(app).post('/api/auth/register').send(registerPayload({
            role: 'provider',
            password: BUSINESS_PW,
            providerCategory: 'Beauty & Grooming',
        }));
        expect(second.status).toBe(201);
        expect(second.body.data.user.role).toBe('provider');
        expect(second.body.data.user.accountType).toBe('business');

        const accounts = await User.find({ email: EMAIL });
        expect(accounts).toHaveLength(2);
    });

    it('still rejects a duplicate account of the SAME type', async () => {
        await request(app).post('/api/auth/register').send(registerPayload());
        const dup = await request(app).post('/api/auth/register').send(registerPayload());
        expect(dup.status).toBe(400);
        expect(dup.body.message).toMatch(/customer account with this email already exists/i);
    });

    it('stamps accountType from role on creation', async () => {
        await request(app).post('/api/auth/register').send(registerPayload({
            role: 'provider', providerCategory: 'Beauty & Grooming',
        }));
        const doc = await User.findOne({ email: EMAIL });
        expect(doc.accountType).toBe('business');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN SCOPED BY ACCOUNT TYPE
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login with accountType', () => {
    beforeEach(makeDualAccounts);

    it('business login authenticates the business account', async () => {
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: BUSINESS_PW, accountType: 'business' });
        expect(res.status).toBe(200);
        expect(res.body.data.user.role).toBe('provider');
        expect(res.body.data.user.accountType).toBe('business');
    });

    it('customer login authenticates the customer account', async () => {
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(res.status).toBe(200);
        expect(res.body.data.user.role).toBe('customer');
        expect(res.body.data.user.accountType).toBe('customer');
    });

    it('business login rejects the customer account password (no cross-side auth)', async () => {
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'business' });
        expect(res.status).not.toBe(200);
    });

    it('directs a customer-only email trying the business side to the customer app (403 + guidance)', async () => {
        await User.deleteMany({ email: EMAIL, accountType: 'business' });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'business' });
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/customer account/i);
        expect(res.body.accountType).toBe('customer');
    });

    it('directs a business-only email trying the customer side to the business app (403 + guidance)', async () => {
        await User.deleteMany({ email: EMAIL, accountType: 'customer' });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: BUSINESS_PW, accountType: 'customer' });
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/business account/i);
    });

    it('never reveals the other-side account on a WRONG password (generic 401)', async () => {
        await User.deleteMany({ email: EMAIL, accountType: 'business' });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: 'WrongPass1!', accountType: 'business' });
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/invalid credentials/i);
    });

    it('rejects an invalid accountType value', async () => {
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'superuser' });
        expect(res.status).toBe(400);
    });

    it('legacy login without accountType still works (password picks the account)', async () => {
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: BUSINESS_PW });
        expect(res.status).toBe(200);
        expect(res.body.data.user.role).toBe('provider');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH / SSO SCOPING
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/refresh with accountType (SSO bootstrap scoping)', () => {
    beforeEach(makeDualAccounts);

    const loginAs = async (password, accountType) => {
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password, accountType });
        return res.body.data;
    };

    it('accepts a refresh scoped to the matching account type', async () => {
        const { refreshToken } = await loginAs(BUSINESS_PW, 'business');
        const res = await request(app).post('/api/auth/refresh')
            .send({ refreshToken, accountType: 'business' });
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeTruthy();
    });

    it('rejects a customer session presented to the business side (and vice versa)', async () => {
        const { refreshToken } = await loginAs(CUSTOMER_PW, 'customer');
        const res = await request(app).post('/api/auth/refresh')
            .send({ refreshToken, accountType: 'business' });
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/customer account/i);
    });

    it('unscoped refresh keeps working (legacy clients)', async () => {
        const { refreshToken } = await loginAs(CUSTOMER_PW, 'customer');
        const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
        expect(res.status).toBe(200);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BECOME PROVIDER GUARD
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/auth/become-provider with a dual email', () => {
    it('blocks upgrading a customer account when the email already has a business account', async () => {
        await makeDualAccounts();
        const login = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });

        const res = await request(app).put('/api/auth/become-provider')
            .set('Authorization', `Bearer ${login.body.data.token}`)
            .send({ providerCategory: 'Beauty & Grooming' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/business account with this email already exists/i);

        const stillCustomer = await User.findOne({ email: EMAIL, accountType: 'customer' });
        expect(stillCustomer.role).toBe('customer');
    });

    it('still upgrades when the email has no business account', async () => {
        await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
        const login = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });

        const res = await request(app).put('/api/auth/become-provider')
            .set('Authorization', `Bearer ${login.body.data.token}`)
            .send({ providerCategory: 'Beauty & Grooming' });
        expect(res.status).toBe(200);

        const upgraded = await User.findOne({ email: EMAIL });
        expect(upgraded.role).toBe('provider');
        expect(upgraded.accountType).toBe('business');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD SCOPING
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/forgot-password with accountType', () => {
    it('only sends a reset link for the requested account type', async () => {
        await makeDualAccounts();
        const res = await request(app).post('/api/auth/forgot-password')
            .send({ email: EMAIL, accountType: 'business' });
        expect(res.status).toBe(200);
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);

        const business = await User.findOne({ email: EMAIL, accountType: 'business' })
            .select('+passwordResetToken');
        const customer = await User.findOne({ email: EMAIL, accountType: 'customer' })
            .select('+passwordResetToken');
        expect(business.passwordResetToken).toBeTruthy();
        expect(customer.passwordResetToken).toBeFalsy();
    });

    it('without accountType, every local account with that email gets a link', async () => {
        await makeDualAccounts();
        const res = await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });
        expect(res.status).toBe(200);
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// DUAL-ACCOUNT DETECTION (drives the "Where would you like to go?" chooser)
// ─────────────────────────────────────────────────────────────────────────────
describe('login reports the other side the same credentials also unlock', () => {
    it('same password on both sides → each login names the other side', async () => {
        await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
        await makeProvider({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });

        const asCustomer = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(asCustomer.status).toBe(200);
        expect(asCustomer.body.data.alsoAccountType).toBe('business');

        const asBusiness = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'business' });
        expect(asBusiness.status).toBe(200);
        expect(asBusiness.body.data.alsoAccountType).toBe('customer');
    });

    it('different passwords per side → null (these credentials open one side only)', async () => {
        await makeDualAccounts();
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(res.status).toBe(200);
        expect(res.body.data.alsoAccountType).toBeNull();
        // ...but the account still EXISTS, and that is what the destination
        // chooser asks about. Conflating the two questions is what silently
        // dropped these people on the customer site.
        expect(res.body.data.otherSide).toEqual({ accountType: 'business', sameCredentials: false });
    });

    it('single account → null', async () => {
        await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(res.status).toBe(200);
        expect(res.body.data.alsoAccountType).toBeNull();
    });

    it('an admin-suspended other-side account does not count', async () => {
        await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
        // Suspended by an admin: isActive false with no deactivatedAt.
        await makeProvider({ email: EMAIL, password: CUSTOMER_PW, isVerified: true, isActive: false });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(res.status).toBe(200);
        expect(res.body.data.alsoAccountType).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// otherSide — "does this email have a profile on the other side at all?"
// The website's destination chooser reads THIS, not alsoAccountType. The two
// diverge whenever the sides drift to different passwords, which the product
// itself produces: registration is per-side and so is password reset.
// ─────────────────────────────────────────────────────────────────────────────
describe('login reports whether the other side EXISTS', () => {
    it('same password on both sides → exists, and the credentials carry across', async () => {
        await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
        await makeProvider({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(res.body.data.otherSide).toEqual({ accountType: 'business', sameCredentials: true });
    });

    it('the business side reports the customer side the same way', async () => {
        await makeDualAccounts();
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: BUSINESS_PW, accountType: 'business' });
        expect(res.body.data.otherSide).toEqual({ accountType: 'customer', sameCredentials: false });
    });

    it('a social-only other side exists but cannot be carried into', async () => {
        await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
        const social = await makeProvider({ email: EMAIL, password: BUSINESS_PW, isVerified: true });
        // Google account: no local password to match.
        await User.updateOne({ _id: social._id }, { $set: { provider: 'google', googleId: 'g-1' }, $unset: { password: '' } });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(res.body.data.otherSide).toEqual({ accountType: 'business', sameCredentials: false });
    });

    it('single account → null', async () => {
        await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(res.body.data.otherSide).toBeNull();
    });

    it('an admin-suspended other side is a dead end, so it does not count', async () => {
        await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
        await makeProvider({ email: EMAIL, password: CUSTOMER_PW, isVerified: true, isActive: false });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(res.body.data.otherSide).toBeNull();
        expect(res.body.data.alsoAccountType).toBeNull();
    });

    // Anti-enumeration: registration is per-side and needs no verification, so
    // an unverified account proves only "I know this password", never "I own
    // this inbox". Existence is revealed at the same bar as a password reset.
    it('an UNVERIFIED caller is not told a different-password account exists', async () => {
        await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: false });
        await makeProvider({ email: EMAIL, password: BUSINESS_PW, isVerified: true });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(res.status).toBe(200);
        expect(res.body.data.otherSide).toBeNull();
    });

    it('an unverified caller who proves BOTH passwords still gets the choice', async () => {
        await makeUser({ email: EMAIL, password: CUSTOMER_PW, isVerified: false });
        await makeProvider({ email: EMAIL, password: CUSTOMER_PW, isVerified: true });
        const res = await request(app).post('/api/auth/login')
            .send({ email: EMAIL, password: CUSTOMER_PW, accountType: 'customer' });
        expect(res.body.data.otherSide).toEqual({ accountType: 'business', sameCredentials: true });
    });
});
