/**
 * CORS allowlist — the Ionic/Capacitor native WebView origins must be accepted
 * (credentialed), while the response still reflects the SPECIFIC origin (never
 * '*') so the change stays purely additive for the web apps.
 */
const request = require('supertest');
const app = require('../../../server');

// A DB-free, always-200 GET to inspect CORS response headers (app-level cors()
// middleware runs before all routes, so any endpoint reflects the origin).
const HEALTH = '/api/seo/robots.txt';

describe('CORS allowlist', () => {
    test.each([
        'capacitor://localhost', // iOS native WebView
        'http://localhost',      // Android native WebView (bare, no port)
        'https://localhost',     // Android https scheme
        'http://localhost:3002', // customer dev shell (existing)
        'http://localhost:3003', // business dev shell (existing)
    ])('allows credentialed origin %s and reflects it exactly', async (origin) => {
        const res = await request(app).get(HEALTH).set('Origin', origin);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
        // Never a wildcard — that would be invalid with credentials anyway.
        expect(res.headers['access-control-allow-origin']).not.toBe('*');
    });

    test('does not reflect an un-allowlisted origin', async () => {
        const res = await request(app).get(HEALTH).set('Origin', 'https://evil.example');
        expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    });

    test('non-browser requests (no Origin header) still work', async () => {
        const res = await request(app).get(HEALTH);
        expect(res.status).toBe(200);
    });
});
