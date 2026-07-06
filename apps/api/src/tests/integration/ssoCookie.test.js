/**
 * Epic 1.3 — SSO refresh cookie (DUAL_APP_SPEC.md §4.3 / architecture §8).
 * Login/refresh set an httpOnly bp_rt cookie scoped to the parent domain in
 * prod; /auth/refresh accepts it in place of a body token so a sibling
 * subdomain app can bootstrap a session; logout clears it.
 */
const request = require('supertest');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
}));

const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, authHeader } = require('../helpers/factories');

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(async () => { await testDb.clearDatabase(); jest.clearAllMocks(); });

const cookieOf = (res) =>
    (res.headers['set-cookie'] || []).find((c) => c.startsWith('bp_rt='));

describe('SSO refresh cookie', () => {
    it('login sets an httpOnly bp_rt cookie', async () => {
        const user = await makeUser();
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: user.email, password: 'Password1!' });
        expect(res.status).toBe(200);
        const cookie = cookieOf(res);
        expect(cookie).toBeTruthy();
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
        expect(cookie).toMatch(/Path=\/api\/auth/i);
    });

    it('refresh accepts the cookie with no body token (cross-subdomain bootstrap)', async () => {
        const user = await makeUser();
        const login = await request(app)
            .post('/api/auth/login')
            .send({ email: user.email, password: 'Password1!' });
        const cookie = cookieOf(login).split(';')[0];

        const res = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', cookie)
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeTruthy();
        expect(res.body.data.refreshToken).toBeTruthy();
        // …and rotates the cookie too
        expect(cookieOf(res)).toBeTruthy();

        // still 400 when neither body nor cookie carries a token
        const bare = await request(app).post('/api/auth/refresh').send({});
        expect(bare.status).toBe(400);
    });

    it('logout expires the cookie', async () => {
        const user = await makeUser();
        const res = await request(app)
            .post('/api/auth/logout')
            .set(authHeader(user));
        expect(res.status).toBe(200);
        const cookie = cookieOf(res);
        expect(cookie).toBeTruthy();
        expect(cookie).toMatch(/Max-Age=0/i);
    });
});
