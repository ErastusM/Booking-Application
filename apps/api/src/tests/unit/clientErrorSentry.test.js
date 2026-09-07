/**
 * The public client-error sink forwards browser errors into Sentry (when a DSN is
 * configured) so frontend failures land in the same aggregated dashboard as the
 * API's own errors — reusing the existing pipeline, no frontend SDK. When Sentry
 * is inert, the sink behaves exactly as before.
 */
const express = require('express');
const request = require('supertest');

// Replace the Sentry init module with an "enabled" fake that records captures.
jest.mock('../../../instrument', () => {
    const calls = [];
    const scope = {
        setTag() { return this; },
        setExtras() { return this; },
        setFingerprint() { return this; },
        setLevel() { return this; },
    };
    return {
        isEnabled: () => true,
        withScope: (cb) => cb(scope),
        captureMessage: (msg) => calls.push(msg),
        __calls: calls,
    };
});

const Sentry = require('../../../instrument');
const clientErrorRoutes = require('../../routes/clientErrorRoutes');

const makeApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/client-errors', clientErrorRoutes);
    return app;
};

it('acks 204 and forwards the browser error into Sentry (grouped by app+type+message)', async () => {
    const res = await request(makeApp())
        .post('/api/client-errors')
        .send({ app: 'customer', type: 'uncaught', message: 'boom happened', stack: 'at foo (x.js:1)', url: 'https://app/x' });

    expect(res.status).toBe(204);
    expect(Sentry.__calls).toContain('[customer] boom happened');
});
