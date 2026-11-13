/**
 * "Check the PayGate connection" (Money → Settings): proves the server's
 * PayGate settings for business plan payments before any business pays. Against the stand-in PayGate, with the
 * public addresses probed through a stub.
 */
const request = require('supertest');
const app = require('../../../server');
const testDb = require('../helpers/testDb');
const SubscriptionPayment = require('../../models/SubscriptionPayment');
const FinancialAuditLog = require('../../models/FinancialAuditLog');
const paygate = require('../../services/paygate');
const paygateCheck = require('../../services/paygateCheck');
const { makeProvider, makeFinanceAdmin, authHeader, financeHeader } = require('../helpers/factories');
const { createFakePaygate, KEY } = require('../helpers/fakePaygate');

const gw = createFakePaygate();
const ENV_KEYS = ['PAYGATE_ID', 'PAYGATE_PASSWORD', 'PAYGATE_ENCRYPTION_KEY', 'PAYGATE_RECURRING_ID', 'PAYGATE_RECURRING_PASSWORD', 'PAYGATE_CALLBACK_BASE_URL', 'BUSINESS_ORIGIN', 'SUBSCRIPTION_BILLING_ENABLED'];
let saved;
let probes;

beforeAll(async () => { await testDb.connect(); });
afterAll(async () => { gw.uninstall(); paygateCheck.setHttp(); await testDb.closeDatabase(); });
beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    gw.install();
    // A real terminal's id (not PayGate's public test account), and the live addresses.
    process.env.PAYGATE_ID = '10099998888';
    process.env.PAYGATE_CALLBACK_BASE_URL = 'https://api.bookplus.pro';
    process.env.BUSINESS_ORIGIN = 'https://business.bookplus.pro';
    process.env.SUBSCRIPTION_BILLING_ENABLED = 'true';
    probes = [];
    paygateCheck.setHttp(async (url, opts = {}) => {
        probes.push([opts.method || 'GET', url]);
        if (url.endsWith('/api/subscriptions/paygate/notify')) return { status: 400, text: 'INVALID' };
        return { status: 200, text: '' };
    });
});
afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    gw.reset();
    await testDb.clearDatabase();
});

const run = async () => {
    const fin = await makeFinanceAdmin({ adminRoles: ['finance'] });
    const res = await request(app).post('/api/admin/finance/paygate-check').set(financeHeader(fin));
    expect(res.status).toBe(200);
    return { fin, data: res.body.data, by: (k) => res.body.data.items.find((i) => i.key === k) };
};

describe('PayGate connection check', () => {
    it('everything right: a test session opens, is signed with our key, reads back; the addresses answer; no money and no payment record', async () => {
        const { fin, data, by } = await run();
        expect(data.ready).toBe(true);
        expect(data.items.map((i) => [i.key, i.status])).toEqual([
            ['switched_on', 'ok'], ['credentials', 'ok'], ['recurring_credentials', 'ok'], ['addresses', 'ok'], ['session', 'ok'],
            ['signature', 'ok'], ['read_back', 'ok'], ['notify', 'ok'], ['result_page', 'ok'],
        ]);
        expect(by('credentials').detail).toContain('•••• 8888');
        expect(JSON.stringify(data)).not.toContain('10099998888');
        expect(JSON.stringify(data)).not.toContain(KEY);
        expect(by('addresses').detail).toBe('Results go to https://api.bookplus.pro/api/subscriptions/paygate/notify; owners come back to https://business.bookplus.pro/account?section=plan.');
        expect(by('read_back').detail).toMatch(/Not Done/);

        // One N$5.00 session at PayGate for a BPCHECK reference, with the real callback addresses.
        const web = gw.calls.filter((c) => c.body.includes('<WebPaymentRequest>'));
        expect(web).toHaveLength(1);
        expect(web[0].body).toMatch(/<MerchantOrderId>BPCHECK[0-9A-F]{12}<\/MerchantOrderId>/);
        expect(web[0].body).toContain('<Amount>500</Amount>');
        expect(web[0].body).toContain('<NotifyUrl>https://api.bookplus.pro/api/subscriptions/paygate/notify</NotifyUrl>');
        expect(web[0].body).toContain(`<Email>${fin.email}</Email>`);
        expect(await SubscriptionPayment.countDocuments()).toBe(0);
        expect(probes).toEqual([['POST', 'https://api.bookplus.pro/api/subscriptions/paygate/notify'], ['GET', 'https://business.bookplus.pro/account?section=plan']]);

        // Audited, without secrets.
        const audit = await FinancialAuditLog.findOne({ action: 'paygate.check' }).lean();
        expect(audit.details).toMatchObject({ ready: true });
        expect(JSON.stringify(audit)).not.toContain(KEY);
    });

    it('PayGate signs with a different key than the password: caught, and fixed by PAYGATE_ENCRYPTION_KEY', async () => {
        process.env.PAYGATE_PASSWORD = 'not-the-encryption-key';
        let { data, by } = await run();
        expect(data.ready).toBe(false);
        expect(by('session').status).toBe('ok');
        expect(by('signature')).toMatchObject({ status: 'fail', detail: expect.stringContaining('Set PAYGATE_ENCRYPTION_KEY to the terminal’s Encryption Key') });

        process.env.PAYGATE_ENCRYPTION_KEY = KEY;
        ({ data, by } = await run());
        expect(by('signature').status).toBe('ok');
        expect(by('credentials').detail).toContain('with a separate encryption key');
        // Callbacks are then checked with that key.
        const ref = 'BS0123456789ABCDEF0123456789AB';
        gw.tx.set('PR-X', { reference: ref, amountCents: 100, currency: 'NAD', code: 1, transactionId: '1' });
        const body = gw.notifyBody(ref);
        expect(paygate.verifyPostedChecksum([...new URLSearchParams(body)])).toBe(true);
    });

    it('PayGate refuses the session: says what PayGate said; the checks that need a session are skipped', async () => {
        gw.initFail = true;
        const { by } = await run();
        expect(by('session')).toMatchObject({ status: 'fail', detail: expect.stringContaining('PayGate said: Service unavailable') });
        expect(by('signature').status).toBe('skipped');
        expect(by('read_back').status).toBe('skipped');
    });

    it('missing settings, PayGate’s test account, wrong addresses, a redirect and a switched-off API are each named', async () => {
        delete process.env.PAYGATE_RECURRING_ID;
        expect((await run()).by('recurring_credentials')).toMatchObject({ status: 'fail', detail: expect.stringContaining('PAYGATE_RECURRING_ID') });
        delete process.env.PAYGATE_ID;
        let { by } = await run();
        expect(by('credentials')).toMatchObject({ status: 'fail', detail: 'PAYGATE_ID or PAYGATE_PASSWORD is not set on the server.' });
        expect(by('session').status).toBe('skipped');

        process.env.PAYGATE_ID = paygateCheck.TEST_PAYGATE_ID;
        process.env.BUSINESS_ORIGIN = 'http://business.bookplus.pro';
        ({ by } = await run());
        expect(by('credentials')).toMatchObject({ status: 'warn', detail: expect.stringContaining('public test account') });
        expect(by('addresses')).toMatchObject({ status: 'fail', detail: expect.stringContaining('set BUSINESS_ORIGIN') });
        expect(by('result_page').status).toBe('skipped');

        process.env.BUSINESS_ORIGIN = 'https://business.bookplus.pro';
        process.env.SUBSCRIPTION_BILLING_ENABLED = 'false';
        paygateCheck.setHttp(async (url) => (url.includes('/notify')
            ? { status: 404, text: '' }
            : { status: 301, text: '', location: 'https://business.bookplus.pro/login' }));
        ({ by } = await run());
        expect(by('switched_on').status).toBe('warn');
        expect(by('notify')).toMatchObject({ status: 'fail', detail: expect.stringContaining('plan payments are off on the API') });
        expect(by('result_page')).toMatchObject({ status: 'warn', detail: expect.stringContaining('redirects to https://business.bookplus.pro/login') });

        paygateCheck.setHttp(async () => { throw new Error('getaddrinfo ENOTFOUND api.bookplus.pro'); });
        ({ by } = await run());
        expect(by('notify')).toMatchObject({ status: 'fail', detail: expect.stringContaining('ENOTFOUND') });
    });

    it('only finance staff can run it', async () => {
        const owner = await makeProvider();
        expect((await request(app).post('/api/admin/finance/paygate-check').set(authHeader(owner))).status).toBe(403);
    });
});
