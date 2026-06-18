/**
 * Auth routes integration tests.
 * Covers: register, login, logout, token revocation, exchangeOAuthCode, verifyEmail.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeAdmin } = require('../helpers/factories');
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

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
    const validPayload = {
        name: 'Alice Test',
        email: 'alice@example.com',
        password: 'Password1!',
        phone: '+15550001234',
        role: 'customer',
    };

    it('creates a new customer and returns 201 with token', async () => {
        const res = await request(app).post('/api/auth/register').send(validPayload);
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.token).toBeTruthy();
        expect(res.body.data.user.role).toBe('customer');
    });

    it('returns 400 when email is missing', async () => {
        const { email, ...rest } = validPayload;
        const res = await request(app).post('/api/auth/register').send(rest);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('returns 400 when password is too weak (no special char)', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ ...validPayload, password: 'Password1' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/uppercase|special/i);
    });

    it('returns 400 when password has no uppercase letter', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ ...validPayload, password: 'password1!' });
        expect(res.status).toBe(400);
    });

    it('returns 400 when password is shorter than 8 chars', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ ...validPayload, password: 'P1!' });
        expect(res.status).toBe(400);
    });

    it('returns 400 when duplicate email', async () => {
        await request(app).post('/api/auth/register').send(validPayload);
        const res = await request(app).post('/api/auth/register').send(validPayload);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already exists/i);
    });

    it('cannot register as admin via the register endpoint', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ ...validPayload, email: 'hacker@example.com', role: 'admin' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/customer or provider/i);
    });

    it('new user is not verified by default', async () => {
        const res = await request(app).post('/api/auth/register').send(validPayload);
        expect(res.body.data.user.isVerified).toBe(false);
    });

    it('provider registration requires a providerCategory', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ ...validPayload, role: 'provider', providerCategory: '', email: 'p@test.com' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/category/i);
    });

    it('provider registration rejects an overlong providerCategory', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ ...validPayload, role: 'provider', providerCategory: 'x'.repeat(101), email: 'p2@test.com' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/category/i);
    });

    it('provider registration succeeds with valid providerCategory', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ ...validPayload, role: 'provider', providerCategory: 'Beauty & Grooming', email: 'provider@test.com' });
        expect(res.status).toBe(201);
        expect(res.body.data.user.role).toBe('provider');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
    beforeEach(async () => {
        await makeUser({ email: 'login@example.com', password: 'Password1!', isVerified: true });
    });

    it('returns 200 and token for valid credentials', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'login@example.com', password: 'Password1!' });
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeTruthy();
        expect(res.body.data.refreshToken).toBeTruthy();
    });

    it('returns 401 for wrong password', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'login@example.com', password: 'WrongPass1!' });
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/invalid credentials/i);
    });

    it('returns 401 for non-existent email', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'nobody@example.com', password: 'Password1!' });
        expect(res.status).toBe(401);
    });

    it('returns 400 when fields are missing', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'login@example.com' });
        expect(res.status).toBe(400);
    });

    it('returned JWT contains correct userId', async () => {
        const user = await User.findOne({ email: 'login@example.com' });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'login@example.com', password: 'Password1!' });
        const decoded = jwt.verify(res.body.data.token, process.env.JWT_SECRET);
        expect(decoded.id).toBe(user._id.toString());
    });

    it('returned JWT does NOT expose password hash', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'login@example.com', password: 'Password1!' });
        expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/); // bcrypt hash pattern
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT + TOKEN REVOCATION
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/logout + token revocation', () => {
    it('increments tokenVersion on logout, old token rejected on next request', async () => {
        const user = await makeUser({ email: 'logout@example.com', password: 'Password1!', isVerified: true });
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ email: 'logout@example.com', password: 'Password1!' });
        const { token } = loginRes.body.data;

        // Confirm token works before logout
        const beforeLogout = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', `Bearer ${token}`);
        expect(beforeLogout.status).toBe(200);

        // Logout
        await request(app)
            .post('/api/auth/logout')
            .set('Authorization', `Bearer ${token}`);

        // Old token should now be rejected
        const afterLogout = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', `Bearer ${token}`);
        expect(afterLogout.status).toBe(401);
    });

    it('returns 401 for requests with no token', async () => {
        const res = await request(app).get('/api/appointments');
        expect(res.status).toBe(401);
    });

    it('returns 401 for tampered token (bad signature)', async () => {
        const tamperedToken = jwt.sign(
            { id: 'fakeid', tokenVersion: 0 },
            'wrong_secret'
        );
        const res = await request(app)
            .get('/api/appointments')
            .set('Authorization', `Bearer ${tamperedToken}`);
        expect(res.status).toBe(401);
    });

    it('returns 401 for expired token', async () => {
        const expiredToken = jwt.sign(
            { id: 'some-id', tokenVersion: 0 },
            process.env.JWT_SECRET,
            { expiresIn: '-1s' }
        );
        const res = await request(app)
            .get('/api/appointments')
            .set('Authorization', `Bearer ${expiredToken}`);
        expect(res.status).toBe(401);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH ACCESS TOKEN
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
    const creds = { email: 'refresh@example.com', password: 'Password1!' };

    beforeEach(async () => {
        await makeUser({ ...creds, isVerified: true });
    });

    const loginAndGetTokens = async () => {
        const res = await request(app).post('/api/auth/login').send(creds);
        return res.body.data; // { token, refreshToken, user }
    };

    it('exchanges a valid refresh token for a fresh, working access token', async () => {
        const { refreshToken } = await loginAndGetTokens();

        const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeTruthy();
        expect(res.body.data.refreshToken).toBeTruthy();

        // The newly minted access token must authenticate a real request
        const profile = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', `Bearer ${res.body.data.token}`);
        expect(profile.status).toBe(200);
    });

    it('returns 400 when no refresh token is supplied', async () => {
        const res = await request(app).post('/api/auth/refresh').send({});
        expect(res.status).toBe(400);
    });

    it('returns 401 for a malformed refresh token', async () => {
        const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'not-a-real-token' });
        expect(res.status).toBe(401);
    });

    it('rejects an access token used as a refresh token (wrong secret)', async () => {
        const { token } = await loginAndGetTokens();
        const res = await request(app).post('/api/auth/refresh').send({ refreshToken: token });
        expect(res.status).toBe(401);
    });

    it('revokes the refresh token after logout (tokenVersion bump)', async () => {
        const { token, refreshToken } = await loginAndGetTokens();

        // Logout bumps tokenVersion, which the refresh token carries
        await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

        const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/revoked/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXCHANGE OAUTH CODE
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/exchange-code', () => {
    it('returns 400 when no code supplied', async () => {
        const res = await request(app).post('/api/auth/exchange-code').send({});
        expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid / unknown code', async () => {
        const unknownCode = crypto.randomBytes(32).toString('hex');
        const res = await request(app)
            .post('/api/auth/exchange-code')
            .send({ code: unknownCode });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/invalid or expired/i);
    });

    it('returns 400 for an expired code', async () => {
        const expiredCode = crypto.randomBytes(32).toString('hex');
        const expiredCodeHash = crypto.createHash('sha256').update(expiredCode).digest('hex');
        await makeUser({
            email: 'oauth@example.com',
            oauthCode: expiredCodeHash,
            oauthCodeExpiry: new Date(Date.now() - 1000), // already past
        });
        const res = await request(app)
            .post('/api/auth/exchange-code')
            .send({ code: expiredCode });
        expect(res.status).toBe(400);
    });

    it('returns 200 with token for a valid unexpired code, then clears the code', async () => {
        const validCode = crypto.randomBytes(32).toString('hex');
        const validCodeHash = crypto.createHash('sha256').update(validCode).digest('hex');
        await User.create({
            name: 'OAuth User',
            email: 'oauthvalid@example.com',
            password: 'Password1!',
            phone: '+15550009999',
            role: 'customer',
            isVerified: true,
            provider: 'google',
            oauthCode: validCodeHash,
            oauthCodeExpiry: new Date(Date.now() + 600_000),
        });
        const res = await request(app)
            .post('/api/auth/exchange-code')
            .send({ code: validCode });
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeTruthy();

        // Code must be cleared so it can't be reused
        const dbUser = await User.findOne({ email: 'oauthvalid@example.com' }).select('+oauthCode');
        expect(dbUser.oauthCode).toBeNull();
    });

    it('code cannot be used twice (replay attack)', async () => {
        const validCode = crypto.randomBytes(32).toString('hex');
        const validCodeHash = crypto.createHash('sha256').update(validCode).digest('hex');
        await User.create({
            name: 'Replay User',
            email: 'replay@example.com',
            password: 'Password1!',
            phone: '+15550008888',
            role: 'customer',
            isVerified: true,
            provider: 'google',
            oauthCode: validCodeHash,
            oauthCodeExpiry: new Date(Date.now() + 600_000),
        });
        await request(app).post('/api/auth/exchange-code').send({ code: validCode });
        const replay = await request(app).post('/api/auth/exchange-code').send({ code: validCode });
        expect(replay.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE PASSWORD + SESSION REVOCATION
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/auth/change-password', () => {
    const creds = { email: 'changepw@example.com', password: 'Password1!' };

    beforeEach(async () => {
        await makeUser({ ...creds, isVerified: true });
    });

    const login = async () => {
        const res = await request(app).post('/api/auth/login').send(creds);
        return res.body.data; // { token, refreshToken }
    };

    it('changes the password and lets the user sign in with the new one', async () => {
        const { token } = await login();
        const res = await request(app)
            .put('/api/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: 'Password1!', newPassword: 'NewPass1!' });
        expect(res.status).toBe(200);

        const relogin = await request(app).post('/api/auth/login').send({ email: creds.email, password: 'NewPass1!' });
        expect(relogin.status).toBe(200);
    });

    it('rejects a wrong current password', async () => {
        const { token } = await login();
        const res = await request(app)
            .put('/api/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: 'WrongPass1!', newPassword: 'NewPass1!' });
        expect(res.status).toBe(401);
    });

    it('revokes existing sessions — the old access token stops working', async () => {
        const { token } = await login();
        const before = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
        expect(before.status).toBe(200);

        await request(app)
            .put('/api/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: 'Password1!', newPassword: 'NewPass1!' });

        const after = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
        expect(after.status).toBe(401);
    });

    it('revokes the old refresh token after a password change', async () => {
        const { token, refreshToken } = await login();
        await request(app)
            .put('/api/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: 'Password1!', newPassword: 'NewPass1!' });

        const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
        expect(res.status).toBe(401);
    });
});
