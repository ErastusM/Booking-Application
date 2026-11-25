/**
 * "Check the PayGate connection" (admin, Money → Settings): proves the server's
 * PayGate settings for business plan payments work before any business pays,
 * without taking any money. (Bookplus takes card payments only for business
 * subscriptions.)
 *
 *   1. settings     plan billing switched on; terminal 1 (PayWeb 3) has its
 *                   PayGate ID and PayWeb 3 key (and whether it is PayGate's
 *                   public test account); terminal 2 (NON3DS, PayHost) has its
 *                   PayGate ID and PayHost key; https addresses
 *   2. session      PayGate accepts terminal 1's ID and key and opens a N$5.00
 *                   hosted-page session. Nobody is sent to it, so it is never
 *                   paid; it shows in PayGate's MAP as "not done".
 *   3. signature    PayGate signed the session with the key Bookplus checks
 *                   its results with. If not, every payment would be refused
 *                   when PayGate reports back.
 *   4. read back    Bookplus can query that session's status from PayGate
 *   4b. terminal 2  PayHost accepts terminal 2's ID and PayHost key (a query
 *                   for a transaction that cannot exist; nothing is charged)
 *   5. notify       the public address PayGate posts results to reaches the
 *                   Bookplus API (it answers a blank post with "INVALID")
 *   6. result page  the page owners come back to (Account, Your plan) opens
 *                   directly, not through a redirect
 *
 * Nothing secret is returned: the PayGate ID is shown as its last 4 digits.
 */
const crypto = require('crypto');
const paygate = require('./paygate');
const billing = require('./subscriptionBilling');
const { subscriptionBillingEnabled } = require('../constants/features');

const TEST_PAYGATE_ID = '10011072130'; // PayGate's public test account
const CHECK_AMOUNT_CENTS = 500;
const HTTP_TIMEOUT_MS = 8000;

// HTTP probe; tests replace it. Resolves { status, text, location } or throws.
const defaultHttp = async (url, { method = 'GET', body, headers } = {}) => {
    const res = await fetch(url, { method, body, headers, redirect: 'manual', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    const text = method === 'GET' ? '' : (await res.text()).slice(0, 200);
    return { status: res.status, text, location: res.headers.get('location') };
};
let http = defaultHttp;
const setHttp = (fn) => { http = fn || defaultHttp; };

const item = (key, label, status, detail = '') => ({ key, label, status, detail });
const lastFour = (id) => `•••• ${String(id).slice(-4)}`;
const isHttps = (u) => /^https:\/\//i.test(u || '');

/** Run every check; later ones are skipped when an earlier one makes them meaningless. */
const runCheck = async ({ adminEmail = '' } = {}) => {
    const out = [];
    const c = paygate.config();
    const notifyUrl = billing.notifyUrl();
    const resultUrl = billing.resultPageUrl('');

    out.push(subscriptionBillingEnabled()
        ? item('switched_on', 'Plan payments switched on for the API', 'ok', 'SUBSCRIPTION_BILLING_ENABLED is on.')
        : item('switched_on', 'Plan payments switched on for the API', 'warn', 'SUBSCRIPTION_BILLING_ENABLED is off: PayGate’s messages about plan payments would be refused. Set SUBSCRIPTION_BILLING_ENABLED=true and reload the API when plans are to be paid.'));

    // Terminal 1 (PayWeb 3): the first payment and saving the card.
    const configured = paygate.isConfigured();
    const LABEL1 = 'First payment terminal (PayWeb 3)';
    if (!configured) {
        out.push(item('credentials', LABEL1, 'fail', 'PAYGATE_ID or PAYGATE_ENCRYPTION_KEY (the terminal’s PayWeb 3 key) is not set on the server.'));
    } else if (c.paygateId === TEST_PAYGATE_ID) {
        out.push(item('credentials', LABEL1, 'warn', `PayGate ID ${lastFour(c.paygateId)} is PayGate’s public test account: no real money moves. Use your own terminal’s PayGate ID to take payments.`));
    } else {
        out.push(item('credentials', LABEL1, 'ok', `PayGate ID ${lastFour(c.paygateId)}.`));
    }
    // Terminal 2 (NON3DS, PayHost) charges the saved cards each month.
    const rc = paygate.config('recurring');
    const recurringConfigured = paygate.isConfigured('recurring');
    out.push(recurringConfigured
        ? item('recurring_credentials', 'Monthly payments terminal (NON3DS, PayHost)', 'ok', `PayGate ID ${lastFour(rc.paygateId)}${process.env.PAYGATE_RECURRING_ENCRYPTION_KEY ? ', with its PayWeb 3 key' : ''}.`)
        : item('recurring_credentials', 'Monthly payments terminal (NON3DS, PayHost)', 'fail', 'PAYGATE_RECURRING_ID or PAYGATE_RECURRING_PASSWORD (the terminal’s PayHost key) is not set on the server: saved cards could not be charged each month.'));

    const addressProblems = [];
    if (!isHttps(notifyUrl)) addressProblems.push(`PayGate would post results to ${notifyUrl || '(nothing)'}: set PAYGATE_CALLBACK_BASE_URL to the API’s https address`);
    if (!isHttps(resultUrl)) addressProblems.push(`owners would come back to ${resultUrl || '(nothing)'}: set BUSINESS_ORIGIN to the business app’s https address`);
    out.push(addressProblems.length
        ? item('addresses', 'Addresses PayGate uses', 'fail', `${addressProblems.join('; ')}.`)
        : item('addresses', 'Addresses PayGate uses', 'ok', `Results go to ${notifyUrl}; owners come back to ${resultUrl}.`));

    // 2-4: a real session at PayGate, never paid.
    let session = null;
    let signatureFailed = false;
    if (!configured) {
        out.push(item('session', 'PayGate accepts the first payment terminal', 'skipped', 'Set its PayGate ID and PayWeb 3 key first.'));
    } else {
        const reference = `BPCHECK${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
        try {
            const r = await paygate.initiate({
                reference, amountCents: CHECK_AMOUNT_CENTS, currency: 'NAD',
                customer: { firstName: 'Bookplus', lastName: 'Connection check', email: adminEmail || 'check@bookplus.pro' },
                notifyUrl, returnUrl: billing.returnUrl(),
            });
            if (r.ok) {
                session = { reference, ...r };
                out.push(item('session', 'PayGate accepts the first payment terminal', 'ok', `PayGate opened a N$${(CHECK_AMOUNT_CENTS / 100).toFixed(2)} test session (${reference}). Nobody pays it; it shows in PayGate’s MAP as not done.`));
            } else if (r.error?.code === 'BAD_CHECKSUM') {
                signatureFailed = true;
                out.push(item('session', 'PayGate accepts the first payment terminal', 'ok', 'PayGate opened a test session.'));
            } else {
                out.push(item('session', 'PayGate accepts the first payment terminal', 'fail', `PayGate said: ${r.error?.message || 'no session'}${r.error?.resultCode ? ` (${r.error.resultCode})` : ''}. Check PAYGATE_ID and PAYGATE_ENCRYPTION_KEY (the terminal’s PayWeb 3 key) against the terminal’s details, and that the terminal takes N$.`));
            }
        } catch (err) {
            out.push(item('session', 'PayGate accepts the first payment terminal', 'fail', err.message || 'Could not reach PayGate.'));
        }
    }

    if (signatureFailed) {
        out.push(item('signature', 'PayGate signs with the key Bookplus checks', 'fail', 'PayGate’s signature on the session does not match PAYGATE_ENCRYPTION_KEY, so every payment result would be refused. Copy the terminal’s PayWeb 3 key into it exactly, reload the API and check again.'));
        out.push(item('read_back', 'Bookplus can read a payment’s status from PayGate', 'skipped', 'Fix the key first.'));
    } else if (!session) {
        out.push(item('signature', 'PayGate signs with the key Bookplus checks', 'skipped', 'Needs a session first.'));
        out.push(item('read_back', 'Bookplus can read a payment’s status from PayGate', 'skipped', 'Needs a session first.'));
    } else {
        out.push(item('signature', 'PayGate signs with the key Bookplus checks', 'ok', 'Payment results from PayGate will be accepted.'));
        try {
            const q = await paygate.query({ payRequestId: session.payRequestId, reference: session.reference });
            // PayWeb 3 has no transaction data until someone opens the session's page.
            if (!q.ok && q.error?.resultCode === 'NO_TRANS_DATA') {
                out.push(item('read_back', 'Bookplus can read a payment’s status from PayGate', 'ok', 'PayGate knows the test session; nobody has opened it, so there is nothing to pay.'));
            } else out.push(q.ok
                ? item('read_back', 'Bookplus can read a payment’s status from PayGate', 'ok', `PayGate reports the test session as ${q.transactionStatusDescription || (q.transactionStatusCode === paygate.TX.NOT_DONE ? 'not done' : `status ${q.transactionStatusCode}`)}.`)
                : item('read_back', 'Bookplus can read a payment’s status from PayGate', 'fail', `PayGate said: ${q.error?.message || 'no answer'}.`));
        } catch (err) {
            out.push(item('read_back', 'Bookplus can read a payment’s status from PayGate', 'fail', err.message || 'Could not reach PayGate.'));
        }
    }

    // 4b: terminal 2's PayHost login (nothing is charged).
    if (!recurringConfigured) {
        out.push(item('recurring_login', 'PayHost accepts the monthly payments terminal', 'skipped', 'Set its PayGate ID and PayHost key first.'));
    } else {
        try {
            const l = await paygate.checkPayHostLogin('recurring');
            out.push(l.ok
                ? item('recurring_login', 'PayHost accepts the monthly payments terminal', 'ok', `PayHost accepted PayGate ID ${lastFour(rc.paygateId)} and its key. Nothing was charged.`)
                : item('recurring_login', 'PayHost accepts the monthly payments terminal', 'fail', `PayGate said: ${l.message}${l.resultCode ? ` (${l.resultCode})` : ''}. Check PAYGATE_RECURRING_ID and PAYGATE_RECURRING_PASSWORD (the terminal’s PayHost key).`));
        } catch (err) {
            out.push(item('recurring_login', 'PayHost accepts the monthly payments terminal', 'fail', err.message || 'Could not reach PayGate.'));
        }
    }

    // 5-6: the public addresses, from outside the API (through nginx).
    if (!isHttps(notifyUrl)) {
        out.push(item('notify', 'PayGate can reach Bookplus', 'skipped', 'Fix the address first.'));
    } else {
        try {
            const r = await http(notifyUrl, { method: 'POST', body: '', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            if (r.status === 400 && /INVALID/.test(r.text)) {
                out.push(item('notify', 'PayGate can reach Bookplus', 'ok', `${notifyUrl} answers.`));
            } else if (r.status === 404) {
                out.push(item('notify', 'PayGate can reach Bookplus', 'fail', `${notifyUrl} answered “not found”: plan payments are off on the API, or the address points somewhere else.`));
            } else {
                out.push(item('notify', 'PayGate can reach Bookplus', 'fail', `${notifyUrl} answered ${r.status}${r.location ? ` (redirects to ${r.location})` : ''}, not the Bookplus API.`));
            }
        } catch (err) {
            out.push(item('notify', 'PayGate can reach Bookplus', 'fail', `Could not open ${notifyUrl}: ${err.message || 'network error'}.`));
        }
    }

    if (!isHttps(resultUrl)) {
        out.push(item('result_page', 'The payment result page opens', 'skipped', 'Fix the address first.'));
    } else {
        try {
            const r = await http(resultUrl);
            if (r.status === 200) out.push(item('result_page', 'The payment result page opens', 'ok', `${resultUrl} opens.`));
            else if (r.status >= 300 && r.status < 400) out.push(item('result_page', 'The payment result page opens', 'warn', `${resultUrl} redirects to ${r.location || 'another address'}. Set BUSINESS_ORIGIN to the address it ends on, so owners come straight back.`));
            else out.push(item('result_page', 'The payment result page opens', 'fail', `${resultUrl} answered ${r.status}.`));
        } catch (err) {
            out.push(item('result_page', 'The payment result page opens', 'fail', `Could not open ${resultUrl}: ${err.message || 'network error'}.`));
        }
    }

    return {
        ready: out.every((i) => i.status === 'ok'),
        failed: out.filter((i) => i.status === 'fail').length,
        items: out,
    };
};

module.exports = { runCheck, setHttp, TEST_PAYGATE_ID, CHECK_AMOUNT_CENTS };
