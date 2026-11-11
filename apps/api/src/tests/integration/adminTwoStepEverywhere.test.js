/**
 * Security review (October 2026): every admin request needs a session that
 * passed two-step sign-in, not only the money controls. An admin account can
 * delete users, make admins, move wallet money and read every business, so a
 * password alone must not be enough. Also: session tokens are HS256 only, a
 * refresh token is never a session token, and a refused browser origin is a
 * 403 (not a 500 that pages the alert webhook).
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const User = require('../../models/User');
const {
    makeUser, makeProvider, makeAdmin, authHeader, financeHeader, passwordOnlyHeader,
} = require('../helpers/factories');
const { generateRefreshToken } = require('../../utils/helpers');

beforeAll(async () => { await testDb.connect(); });
afterAll(async () => { await testDb.closeDatabase(); });
afterEach(async () => { await testDb.clearDatabase(); });

const hoursAgo = (h) => Math.floor(Date.now() / 1000) - h * 3600;

describe('admin requests need two-step sign-in', () => {
    it('without two-step set up: only set-up, profile and sign-out work', async () => {
        const admin = await makeAdmin({}, { twoStep: false });
        const target = await makeUser();
        const h = passwordOnlyHeader(admin);

        for (const call of [
            request(app).get('/api/users').set(h),
            request(app).put(`/api/users/${target._id}/role`).set(h).send({ role: 'admin' }),
            request(app).put(`/api/users/${target._id}/active`).set(h).send({ isActive: false }),
            request(app).get('/api/provider-wallet/admin/summary').set(h),
            request(app).get('/api/analytics/admin/overview').set(h),
            request(app).get('/api/appointments').set(h),
        ]) {
            const res = await call;
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('mfa_setup_required');
        }
        // Nothing changed.
        expect(await User.findById(target._id).lean()).toMatchObject({ role: 'customer', isActive: true });

        expect((await request(app).get('/api/auth/mfa').set(h)).status).toBe(200);
        expect((await request(app).get('/api/auth/profile').set(h)).status).toBe(200);
        expect((await request(app).get('/api/auth/profile?x=1').set(h)).status).toBe(200);
        expect((await request(app).post('/api/auth/mfa/setup').set(h)).status).toBe(200);
        expect((await request(app).put('/api/auth/profile').set(h).send({ name: 'Changed' })).body.code).toBe('mfa_setup_required');
        expect((await request(app).post('/api/auth/logout').set(h)).status).toBe(200);
    });

    it('with two-step on: a password-only or 13-hour-old session is asked for the code; a confirmed one works', async () => {
        const admin = await makeAdmin();
        const target = await makeUser();

        for (const h of [passwordOnlyHeader(admin), financeHeader(admin, hoursAgo(13))]) {
            const res = await request(app).put(`/api/users/${target._id}/role`).set(h).send({ role: 'admin' });
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('mfa_required');
        }
        expect((await User.findById(target._id).lean()).role).toBe('customer');

        const ok = await request(app).put(`/api/users/${target._id}/role`).set(financeHeader(admin, hoursAgo(1))).send({ role: 'admin' });
        expect(ok.status).toBe(200);
        expect((await User.findById(target._id).lean()).role).toBe('admin');
        expect((await request(app).get('/api/users').set(authHeader(admin))).status).toBe(200);
    });

    it('businesses and clients are not affected', async () => {
        const owner = await makeProvider();
        const client = await makeUser();
        expect((await request(app).get('/api/auth/profile').set(authHeader(owner))).status).toBe(200);
        expect((await request(app).get('/api/appointments/my-appointments').set(authHeader(client))).status).toBe(200);
    });
});

describe('session tokens', () => {
    it('only HS256 is accepted, even with the right key', async () => {
        const user = await makeUser();
        const hs512 = jwt.sign({ id: user._id, tokenVersion: 0 }, process.env.JWT_SECRET, { algorithm: 'HS512', expiresIn: '15m' });
        expect((await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${hs512}`)).status).toBe(401);
    });

    it('a token with no tokenVersion is refused, even one claiming two-step sign-in', async () => {
        // The shape forged with the old leaked key: correctly signed, mfa: true,
        // and no tokenVersion, so no password change, sign-out everywhere or
        // two-step reset could ever revoke it.
        const admin = await makeAdmin();
        const claims = { id: admin._id.toString(), mfa: true, mfaAt: Math.floor(Date.now() / 1000) };
        const session = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '15m' });
        const users = await request(app).get('/api/users').set('Authorization', `Bearer ${session}`);
        expect(users.status).toBe(401);
        expect(users.body.message).toBe('Token has been revoked');

        const refresh = jwt.sign(claims, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '30d' });
        const renewed = await request(app).post('/api/auth/refresh').send({ refreshToken: refresh });
        expect(renewed.status).toBe(401);
        expect(renewed.body.data).toBeUndefined();
    });

    it('a refresh token is not a session token', async () => {
        const user = await makeUser();
        const refresh = generateRefreshToken(user._id, 0, 'jti-1');
        expect((await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${refresh}`)).status).toBe(401);
    });
});

describe('CORS', () => {
    it('a refused origin is a 403, not a 500', async () => {
        const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
        expect(res.status).toBe(403);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
});
