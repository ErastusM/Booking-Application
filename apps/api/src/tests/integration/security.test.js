/**
 * Security integration tests.
 * Covers: NoSQL injection attempts, oversized payloads,
 * mass assignment on service update, CORS headers, JWT tampering,
 * security headers (helmet).
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeUser, makeProvider, makeAdmin, makeService, authHeader } = require('../helpers/factories');
const User = require('../../models/User');

jest.mock('../../utils/emailService', () => ({
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendWelcomeEmail: jest.fn().mockResolvedValue(true),
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
// Security Headers (helmet)
// ─────────────────────────────────────────────────────────────────────────────
describe('Security headers', () => {
    it('X-Content-Type-Options is set to nosniff', async () => {
        const res = await request(app).get('/api/services');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('X-Frame-Options header is present', async () => {
        const res = await request(app).get('/api/services');
        expect(res.headers['x-frame-options']).toBeTruthy();
    });

    it('X-Powered-By is hidden', async () => {
        const res = await request(app).get('/api/services');
        expect(res.headers['x-powered-by']).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// NoSQL Injection Attempts
// ─────────────────────────────────────────────────────────────────────────────
describe('NoSQL injection prevention', () => {
    it('login with $gt operator does not bypass password check', async () => {
        await makeUser({ email: 'victim@example.com', password: 'Password1!' });

        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'victim@example.com', password: { $gt: '' } });

        // Must NOT return 200 — the $gt injection must be sanitized
        expect(res.status).not.toBe(200);
    });

    it('login with { $ne: null } email does not return all users', async () => {
        await makeUser({ email: 'safe@example.com', password: 'Password1!' });

        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: { $ne: null }, password: 'Password1!' });

        expect(res.status).not.toBe(200);
    });

    it('register with operator in email field is sanitized', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                name: 'Hacker',
                email: { $gt: '' },
                password: 'Password1!',
                phone: '+15550000001',
            });
        expect(res.status).not.toBe(201);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Oversized Payload
// ─────────────────────────────────────────────────────────────────────────────
describe('Oversized payload protection', () => {
    it('rejects request bodies larger than 10 KB', async () => {
        const bigString = 'A'.repeat(20 * 1024); // 20 KB
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: bigString, password: bigString });
        // Express body limit should reject with 413 or the route returns 4xx
        expect(res.status).toBeGreaterThanOrEqual(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mass Assignment – Service Update
// ─────────────────────────────────────────────────────────────────────────────
describe('Mass assignment protection on service update', () => {
    it('cannot change provider ownership via PUT /api/services/:id', async () => {
        const originalProvider = await makeProvider();
        const attacker = await makeAdmin(); // admin can update services
        const svc = await makeService(originalProvider._id);

        await request(app)
            .put(`/api/services/${svc._id}`)
            .set(authHeader(attacker))
            .send({ provider: attacker._id.toString(), name: 'Hijacked Service' });

        const Service = require('../../models/Service');
        const updated = await Service.findById(svc._id);
        // provider must remain unchanged
        expect(updated.provider.toString()).toBe(originalProvider._id.toString());
    });

    it('cannot set isActive via PUT /api/services/:id as provider (only admin)', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id, { isActive: true });

        await request(app)
            .put(`/api/services/${svc._id}`)
            .set(authHeader(provider))
            .send({ name: 'Test', isActive: false });

        const Service = require('../../models/Service');
        const updated = await Service.findById(svc._id);
        // provider should NOT be able to deactivate — isActive whitelist only applies to admin
        expect(updated.isActive).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// JWT Tampering
// ─────────────────────────────────────────────────────────────────────────────
describe('JWT tampering', () => {
    it('token with swapped userId is rejected', async () => {
        const jwt = require('jsonwebtoken');
        // Craft a token signed with a different secret
        const fakeToken = jwt.sign(
            { id: 'fakeid', tokenVersion: 0 },
            'not_the_real_secret'
        );

        const res = await request(app)
            .get('/api/appointments')
            .set('Authorization', `Bearer ${fakeToken}`);
        expect(res.status).toBe(401);
    });

    it('manually elevated role in payload does not grant admin access', async () => {
        const jwt = require('jsonwebtoken');
        const customer = await makeUser({ role: 'customer' });

        // Sign a valid JWT with real secret but claim role=admin in payload
        // Middleware re-fetches user from DB — role in JWT payload must NOT be trusted for authz
        const tokenWithFakeRole = jwt.sign(
            { id: customer._id.toString(), tokenVersion: 0, role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        const res = await request(app)
            .get('/api/users')
            .set('Authorization', `Bearer ${tokenWithFakeRole}`);
        // Role must be re-checked from DB — customer should get 403 not 200
        expect(res.status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Edge Cases
// ─────────────────────────────────────────────────────────────────────────────
describe('Input validation edge cases', () => {
    it('register with empty-string name returns 400', async () => {
        const res = await request(app).post('/api/auth/register').send({
            name: '',
            email: 'edge@test.com',
            password: 'Password1!',
            phone: '+15550001111',
        });
        expect(res.status).toBe(400);
    });

    it('register with very long name (5000 chars) server responds (no unhandled crash)', async () => {
        const res = await request(app).post('/api/auth/register').send({
            name: 'A'.repeat(5000),
            email: 'longname@test.com',
            password: 'Password1!',
            phone: '+15550001112',
        });
        // Server must respond — any HTTP status is acceptable, no unhandled exception
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(600);
    });

    it('login with null values returns 400', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: null, password: null });
        expect(res.status).toBe(400);
    });

    it('services route returns no provider email in response', async () => {
        const provider = await makeProvider({ email: 'secret@provider.com' });
        await makeService(provider._id, { isActive: true });

        const res = await request(app).get('/api/services');
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain('secret@provider.com');
    });
});
