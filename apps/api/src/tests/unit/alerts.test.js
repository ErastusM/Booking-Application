/**
 * Webhook alerting: no-op without config, throttles under storm, never throws.
 */
const { sendAlert, _resetThrottle } = require('../../utils/alerts');

describe('sendAlert', () => {
    const realFetch = global.fetch;
    let calls;

    beforeEach(() => {
        _resetThrottle();
        calls = [];
        global.fetch = jest.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true }; });
        delete process.env.ALERT_WEBHOOK_URL;
    });
    afterEach(() => { global.fetch = realFetch; delete process.env.ALERT_WEBHOOK_URL; process.env.NODE_ENV = 'test'; });

    it('is a no-op without ALERT_WEBHOOK_URL', async () => {
        process.env.NODE_ENV = 'production';
        expect(await sendAlert('t', 'd')).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('is a no-op under NODE_ENV=test even when configured', async () => {
        process.env.ALERT_WEBHOOK_URL = 'https://hooks.example/x';
        expect(await sendAlert('t', 'd')).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('posts the payload and throttles an error storm', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ALERT_WEBHOOK_URL = 'https://hooks.example/x';
        for (let i = 0; i < 9; i++) await sendAlert(`err ${i}`, 'boom');
        expect(calls).toHaveLength(5); // MAX_PER_WINDOW
        const body = JSON.parse(calls[0].opts.body);
        expect(body.text).toMatch(/Bookplus API — err 0/);
        expect(body.text).toMatch(/boom/);
    });

    it('never throws when the webhook itself fails', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ALERT_WEBHOOK_URL = 'https://hooks.example/x';
        global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
        await expect(sendAlert('t', 'd')).resolves.toBe(false);
    });
});
