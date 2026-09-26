/**
 * The API sends an ENFORCED Content-Security-Policy (not report-only) that
 * allows nothing to load and forbids framing (compliance audit point 10).
 */
const request = require('supertest');
const app = require('../../../server');

it('every response carries the locked-down CSP', async () => {
    const res = await request(app).get('/api/seo/robots.txt');
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(res.headers['content-security-policy-report-only']).toBeUndefined();
    for (const d of ["default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'"]) {
        expect(csp).toContain(d);
    }
    expect(csp).not.toContain('unsafe-inline');
});
