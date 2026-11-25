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
const { createFakePaygate, KEY, RECURRING_KEY } = require('../helpers/fakePaygate');

const gw = createFakePaygate();
const ENV_KEYS = ['PAYGATE_ID', 'PAYGATE_PASSWORD', 'PAYGATE_ENCRYPTION_KEY', 'PAYGATE_RECURRING_ID', 'PAYGATE_RECURRING_PASSWORD', 'PAYGATE_RECURRING_ENCRYPTION_KEY', 'PAYGATE_CALLBACK_BASE_URL', 'BUSINESS_ORIGIN', 'SUBSCRIPTION_BILLING_ENABLED'];
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
    it('everything right: a PayWeb 3 test session opens, is signed with our key, reads back; PayHost accepts terminal 2; the addresses answer; no money and no payment record', async () => {
        const { fin, data, by } = await run();
        expect(data.ready).toBe(true);
        expect(data.items.map((i) => [i.key, i.status])).toEqual([
            ['switched_on', 'ok'], ['credentials', 'ok'], ['recurring_credentials', 'ok'], ['addresses', 'ok'], ['session', 'ok'],
            ['signature', 'ok'], ['read_back', 'ok'], ['recurring_login', 'ok'], ['notify', 'ok'], ['result_page', 'ok'],
        ]);
        expect(by('credentials')).toMatchObject({ label: 'First payment terminal (PayWeb 3)', detail: expect.stringContaining('•••• 8888') });
        expect(JSON.stringify(data)).not.toContain('10099998888');
        expect(JSON.stringify(data)).not.toContain(KEY);
        expect(JSON.stringify(data)).not.toContain(RECURRING_KEY);
        expect(by('addresses').detail).toBe('Results go to https://api.bookplus.pro/api/subscriptions/paygate/notify; owners come back to https://business.bookplus.pro/account?section=plan.');
        expect(by('read_back').detail).toMatch(/Not Done/);
        expect(by('recurring_login').detail).toContain('Nothing was charged');

        // One N$5.00 PayWeb 3 session for a BPCHECK reference, with the real callback addresses.
        const sessions = gw.sessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].fields).toMatchObject({
            REFERENCE: expect.stringMatching(/^BPCHECK[0-9A-F]{12}$/), AMOUNT: '500', CURRENCY: 'NAD',
            NOTIFY_URL: 'https://api.bookplus.pro/api/subscriptions/paygate/notify', EMAIL: fin.email,
        });
        // Terminal 2 is only asked about a transaction that cannot exist: nothing charged.
        expect(gw.charges()).toHaveLength(0);
        expect(await SubscriptionPayment.countDocuments()).toBe(0);
        expect(probes).toEqual([['POST', 'https://api.bookplus.pro/api/subscriptions/paygate/notify'], ['GET', 'https://business.bookplus.pro/account?section=plan']]);

        // Audited, without secrets.
        const audit = await FinancialAuditLog.findOne({ action: 'paygate.check' }).lean();
        expect(audit.details).toMatchObject({ ready: true });
        expect(JSON.stringify(audit)).not.toContain(KEY);
    });

    it('a wrong PayWeb 3 key: PayGate refuses the session and the check names the key', async () => {
        process.env.PAYGATE_ENCRYPTION_KEY = 'not-the-payweb-key';
        let { data, by } = await run();
        expect(data.ready).toBe(false);
        expect(by('session')).toMatchObject({ status: 'fail', detail: expect.stringContaining('PayWeb 3 key') });
        expect(by('signature').status).toBe('skipped');

        // PayGate answering with a signature that isn't ours: caught.
        process.env.PAYGATE_ENCRYPTION_KEY = KEY;
        gw.sessionKey = 'some-other-key';
        ({ data, by } = await run());
        expect(by('signature')).toMatchObject({ status: 'fail', detail: expect.stringContaining('PAYGATE_ENCRYPTION_KEY') });
        gw.sessionKey = null;

        ({ data, by } = await run());
        expect(by('signature').status).toBe('ok');
        // Callbacks are then checked with that key.
        const ref = 'BS0123456789ABCDEF0123456789AB';
        gw.tx.set('PR-X', { reference: ref, amountCents: 100, currency: 'NAD', code: 1, transactionId: '1' });
        const body = gw.notifyBody(ref);
        expect(paygate.verifyPostedChecksum([...new URLSearchParams(body)])).toBe(true);
    });

    it('PayGate refuses the session: says what PayGate said; the checks that need a session are skipped', async () => {
        gw.initFail = true;
        const { by } = await run();
        expect(by('session')).toMatchObject({ status: 'fail', detail: expect.stringContaining('not enabled for PayWeb 3') });
        expect(by('signature').status).toBe('skipped');
        expect(by('read_back').status).toBe('skipped');
    });

    it('missing settings, PayGate’s test account, wrong addresses, a redirect and a switched-off API are each named', async () => {
        process.env.PAYGATE_RECURRING_PASSWORD = 'not-the-payhost-key';
        expect((await run()).by('recurring_login')).toMatchObject({ status: 'fail', detail: expect.stringContaining('Incorrect Credentials Supplied (11)') });
        delete process.env.PAYGATE_RECURRING_ID;
        let { by } = await run();
        expect(by('recurring_credentials')).toMatchObject({ status: 'fail', detail: expect.stringContaining('PAYGATE_RECURRING_ID') });
        expect(by('recurring_login').status).toBe('skipped');
        delete process.env.PAYGATE_ID;
        ({ by } = await run());
        expect(by('credentials')).toMatchObject({ status: 'fail', detail: 'PAYGATE_ID or PAYGATE_ENCRYPTION_KEY (the terminal’s PayWeb 3 key) is not set on the server.' });
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
