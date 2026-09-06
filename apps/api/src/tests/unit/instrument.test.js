/**
 * The Sentry init module must be INERT without a DSN — no init, no throw — so the
 * API behaves identically on any deploy that hasn't configured monitoring. (With
 * a DSN set, initialization is exercised by every integration test that boots the
 * server; here we only pin the off-by-default contract.)
 */
describe('instrument (Sentry init)', () => {
    const OLD = process.env.SENTRY_DSN;
    afterEach(() => {
        if (OLD === undefined) delete process.env.SENTRY_DSN;
        else process.env.SENTRY_DSN = OLD;
        jest.resetModules();
    });

    it('loads without a DSN and reports itself disabled', () => {
        delete process.env.SENTRY_DSN;
        jest.resetModules();
        const Sentry = require('../../../instrument');
        expect(typeof Sentry.captureException).toBe('function');
        expect(Sentry.isEnabled()).toBe(false);
    });
});
