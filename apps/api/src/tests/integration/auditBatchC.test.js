/**
 * Re-audit batch C — security + robustness:
 *   C1. POST /api/push/subscribe stored the client-supplied `endpoint` verbatim,
 *       and pushService later POSTs to it — a blind-SSRF primitive. The endpoint
 *       is now pinned to an https known-push-provider host before storage.
 *   C2. The login timing equaliser (a dummy bcrypt compare) only ran when there
 *       were zero candidate rows, so a passwordless (Google-only) account — whose
 *       matchPassword skips bcrypt entirely — answered with ZERO bcrypt work and
 *       was distinguishable by timing. The equaliser now runs whenever no real
 *       comparison was performed.
 *   C3. getMessages dereferenced `appointment.customer.toString()` with no null
 *       guard, 500ing on any guest booking (customer === null). Now null-safe,
 *       matching sendMessage.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const { makeProvider, makeService, makeAppointment, makeUser, authHeader } = require('../helpers/factories');
const User = require('../../models/User');
const PushSubscription = require('../../models/PushSubscription');

jest.mock('../../utils/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue(true) }));

beforeAll(() => testDb.connect());
afterAll(() => testDb.closeDatabase());
afterEach(() => testDb.clearDatabase());

const KEYS = { p256dh: 'BEl' + 'a'.repeat(85), auth: 'c'.repeat(22) };

describe('C1 — push subscribe rejects SSRF endpoints, keeps real push hosts', () => {
    it('refuses internal / non-https endpoints and stores nothing', async () => {
        const user = await makeUser();
        for (const endpoint of [
            'http://169.254.169.254/latest/meta-data/',   // cloud metadata
            'http://localhost:5050/internal',              // loopback
            'http://10.0.0.5/admin',                       // private range
            'https://evil.example.com/hook',               // public but not a push host
            'http://fcm.googleapis.com/fcm/send/x',        // right host, wrong scheme
        ]) {
            const res = await request(app).post('/api/push/subscribe')
                .set(authHeader(user)).send({ endpoint, keys: KEYS });
            expect(res.status).toBe(400);
        }
        expect(await PushSubscription.countDocuments()).toBe(0);
    });

    it('accepts a genuine https push-service endpoint', async () => {
        const user = await makeUser();
        const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
        const res = await request(app).post('/api/push/subscribe')
            .set(authHeader(user)).send({ endpoint, keys: KEYS });
        expect(res.status).toBe(201);
        const sub = await PushSubscription.findOne({ user: user._id });
        expect(sub.endpoint).toBe(endpoint);
    });
});

describe('C2 — login equaliser runs bcrypt even for passwordless accounts', () => {
    it('a Google-only account with a wrong password still spends a bcrypt compare', async () => {
        // Google-only / passwordless: matchPassword short-circuits before bcrypt.
        await User.create({
            name: 'Googler', email: 'googler@test.com', phone: '+15550009000',
            role: 'customer', isVerified: true, provider: 'google',
        });
        const spy = jest.spyOn(bcrypt, 'compare');
        const res = await request(app).post('/api/auth/login')
            .send({ email: 'googler@test.com', password: 'whatever-guess' });
        expect(res.status).toBe(401);              // no password → no sign-in
        expect(spy).toHaveBeenCalled();            // …but the dummy equaliser ran
        spy.mockRestore();
    });

    it('a missing email also spends a bcrypt compare (baseline equaliser)', async () => {
        const spy = jest.spyOn(bcrypt, 'compare');
        const res = await request(app).post('/api/auth/login')
            .send({ email: 'nobody@test.com', password: 'whatever-guess' });
        expect(res.status).toBe(401);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('C3 — getMessages does not crash on a guest booking', () => {
    it('returns 200 (not 500) reading a guest appointment as the provider', async () => {
        const provider = await makeProvider();
        const svc = await makeService(provider._id);
        const appt = await makeAppointment(null, svc._id, provider._id, {
            customer: null, guestName: 'Walk-up', guestEmail: 'guest@test.com',
        });
        const res = await request(app).get(`/api/messages/${appt._id}`).set(authHeader(provider));
        expect(res.status).toBe(200);
        expect(res.status).not.toBe(500);
    });
});
