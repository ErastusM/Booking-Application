/**
 * /api/auth rate limits: strict per IP + account on credential routes, generous
 * per IP on the session calls the apps make on every load — so people sharing a
 * connection (salon Wi-Fi, mobile carrier NAT) don't lock each other out.
 */
const express = require('express');
const request = require('supertest');
const { createAuthRouteLimiter, isCredentialRequest } = require('../../middleware/authRateLimit');

const makeApp = (opts) => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/auth', createAuthRouteLimiter({ enabled: true, ...opts }));
    app.post('/api/auth/login', (req, res) => res.json({ ok: true }));
    app.get('/api/auth/profile', (req, res) => res.json({ ok: true }));
    app.post('/api/auth/refresh', (req, res) => res.json({ ok: true }));
    return app;
};
const from = (ip) => ({ 'X-Forwarded-For': ip });

describe('isCredentialRequest', () => {
    test.each([
        ['POST', '/login', true], ['POST', '/register', true], ['POST', '/forgot-password', true],
        ['PUT', '/change-password', true], ['GET', '/google/callback', true], ['POST', '/staff-invite/abc/accept', true],
        ['GET', '/profile', false], ['POST', '/refresh', false], ['GET', '/sibling', false], ['GET', '/staff-invite/abc', false],
    ])('%s %s → %p', (method, path, expected) => expect(isCredentialRequest({ method, path })).toBe(expected));
});

describe('credential routes', () => {
    test('one account being hammered is limited without locking out others on the same connection', async () => {
        const app = makeApp({ credentialMax: 3, credentialIpMax: 100 });
        for (let i = 0; i < 3; i++) {
            expect((await request(app).post('/api/auth/login').set(from('10.0.0.1')).send({ email: 'a@x.com' })).status).toBe(200);
        }
        expect((await request(app).post('/api/auth/login').set(from('10.0.0.1')).send({ email: 'a@x.com' })).status).toBe(429);
        // A different person on the same public IP still gets in.
        expect((await request(app).post('/api/auth/login').set(from('10.0.0.1')).send({ email: 'b@x.com' })).status).toBe(200);
    });

    test('spraying many accounts from one IP is still capped', async () => {
        const app = makeApp({ credentialMax: 100, credentialIpMax: 4 });
        for (let i = 0; i < 4; i++) {
            expect((await request(app).post('/api/auth/login').set(from('10.0.0.2')).send({ email: `u${i}@x.com` })).status).toBe(200);
        }
        expect((await request(app).post('/api/auth/login').set(from('10.0.0.2')).send({ email: 'u99@x.com' })).status).toBe(429);
    });
});

describe('session routes', () => {
    test('everyday calls don\'t use up the login budget', async () => {
        const app = makeApp({ credentialMax: 2, credentialIpMax: 2, sessionMax: 50 });
        for (let i = 0; i < 20; i++) {
            expect((await request(app).get('/api/auth/profile').set(from('10.0.0.3'))).status).toBe(200);
            expect((await request(app).post('/api/auth/refresh').set(from('10.0.0.3'))).status).toBe(200);
        }
        expect((await request(app).post('/api/auth/login').set(from('10.0.0.3')).send({ email: 'c@x.com' })).status).toBe(200);
    });

    test('have their own ceiling', async () => {
        const app = makeApp({ sessionMax: 5 });
        for (let i = 0; i < 5; i++) expect((await request(app).get('/api/auth/profile').set(from('10.0.0.4'))).status).toBe(200);
        expect((await request(app).get('/api/auth/profile').set(from('10.0.0.4'))).status).toBe(429);
    });
});
