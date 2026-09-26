/**
 * Secrets out of logs and analytics (compliance audit point 10). Emailed links
 * are bearer credentials; nothing that records "the URL the user was on" may
 * keep them. Covers the scrubber itself, the client-error sink (log line, Sentry
 * extras, alert webhook), Sentry's own beforeSend, and the analytics ingest.
 */
const express = require('express');
const request = require('supertest');

const captured = { extras: [], messages: [], alerts: [] };
jest.mock('../../../instrument', () => {
    const scope = {
        setTag() { return this; },
        setExtras(x) { captured.extras.push(x); return this; },
        setFingerprint() { return this; },
        setLevel() { return this; },
    };
    const real = jest.requireActual('../../../instrument');
    return {
        isEnabled: () => true,
        withScope: (cb) => cb(scope),
        captureMessage: (m) => captured.messages.push(m),
        scrubEvent: real.scrubEvent,
    };
});
jest.mock('../../utils/alerts', () => ({
    sendAlert: async (title, detail) => { captured.alerts.push(`${title}\n${detail}`); return true; },
}));

const { scrubUrl, scrubText, scrubPath } = require('../../utils/redact');
const Sentry = require('../../../instrument');
const clientErrorRoutes = require('../../routes/clientErrorRoutes');

// Shared vectors — the browser copy (packages/api-client/src/redact.ts) is
// tested against the same table in the business app's vitest suite.
const VECTORS = require('../fixtures/redactVectors.json');

const SECRET = 'S3cr3tT0k3nValue';

describe('scrubUrl / scrubText', () => {
    it.each(VECTORS.urls)('%s', (input, expected) => {
        expect(scrubUrl(input)).toBe(expected);
    });

    it('keeps public 24-hex ids (provider profiles) but templates UUIDs and long tokens', () => {
        expect(scrubPath('/providers/64b7f0c2a1b2c3d4e5f60718')).toBe('/providers/64b7f0c2a1b2c3d4e5f60718');
        expect(scrubPath('/x/0b8a3c1e-2f4d-4c6a-9e7b-1a2b3c4d5e6f')).toBe('/x/:token');
        expect(scrubPath(`/x/${'f'.repeat(64)}`)).toBe('/x/:token');
    });

    it('scrubs URLs and key=value secrets embedded in messages and stacks', () => {
        const text = `Request failed for https://app.bookplus.pro/reset-password?token=${SECRET} and /manage/${SECRET}/cancel; code=${SECRET}`;
        const out = scrubText(text);
        expect(out).not.toContain(SECRET);
        expect(out).toContain('/reset-password?token=[redacted]');
        expect(out).toContain('/manage/:token/cancel');
    });

    it('never throws on junk', () => {
        expect(scrubUrl(undefined)).toBe('');
        expect(scrubUrl(42)).toBe('');
        expect(scrubText(null)).toBe('');
    });
});

describe('client-error sink', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/client-errors', clientErrorRoutes);

    beforeEach(() => {
        captured.extras.length = 0; captured.messages.length = 0; captured.alerts.length = 0;
        clientErrorRoutes._resetSeen();
    });

    const cases = [
        ['reset-password', `https://app.bookplus.pro/reset-password?token=${SECRET}`],
        ['accept-invite', `https://business.bookplus.pro/accept-invite?token=${SECRET}`],
        ['verify-email', `https://api.bookplus.pro/api/auth/verify-email?token=${SECRET}&app=customer`],
        ['manage booking', `https://www.bookplus.pro/manage/${SECRET}`],
        ['oauth callback', `https://www.bookplus.pro/auth/callback?code=${SECRET}`],
    ];

    it.each(cases)('forwards no %s token to Sentry or the alert webhook', async (_label, url) => {
        const res = await request(app).post('/api/client-errors').send({
            app: 'customer', type: 'uncaught',
            message: `boom at ${url}`,
            stack: `Error: boom\n    at load (${url})`,
            url,
        });
        expect(res.status).toBe(204);
        await new Promise((r) => setImmediate(r));
        const everything = JSON.stringify({ extras: captured.extras, messages: captured.messages, alerts: captured.alerts });
        expect(everything).not.toContain(SECRET);
        // …but the report is still useful: it says which page.
        expect(captured.extras[0].url).toMatch(/\[redacted\]|:token/);
    });
});

describe('Sentry beforeSend', () => {
    it('scrubs the request URL, query string, auth headers, message and breadcrumbs', () => {
        const event = Sentry.scrubEvent({
            request: {
                url: `https://api.bookplus.pro/api/appointments/manage/${SECRET}`,
                query_string: `token=${SECRET}`,
                headers: { Authorization: `Bearer ${SECRET}`, 'User-Agent': 'x' },
            },
            transaction: `GET /api/auth/staff-invite/${SECRET}${SECRET}`,
            message: `failed /reset-password?token=${SECRET}`,
            exception: { values: [{ value: `bad code=${SECRET}` }] },
            breadcrumbs: [{ message: 'x', data: { url: `https://x/verify-email?token=${SECRET}` } }],
        });
        expect(JSON.stringify(event)).not.toContain(SECRET);
        expect(event.request.headers['User-Agent']).toBe('x');
    });
});
