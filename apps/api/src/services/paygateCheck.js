/**
 * "Check the PayGate connection" (admin, Money → Settings): proves the server's
 * PayGate settings work before anyone pays, without taking any money.
 *
 *   1. settings     online payments switched on, the PayGate ID and password
 *                   set, https addresses (and whether it is PayGate's public
 *                   test account)
 *   2. session      PayGate accepts the ID and password and opens a N$5.00
 *                   hosted-page session. Nobody is sent to it, so it is never
 *                   paid; it shows in PayGate's MAP as "not done".
 *   3. signature    PayGate signed the session with the key Bookplus checks
 *                   callbacks with (PAYGATE_ENCRYPTION_KEY, else the password).
 *                   If not, every payment would be refused when PayGate
 *                   reports back, so this is the check that matters most.
 *   4. read back    Bookplus can query that session's status from PayGate
 *   5. notify       the public address PayGate posts results to reaches the
 *                   Bookplus API (it answers a blank post with "INVALID")
 *   6. result page  the address clients come back to opens directly, not
 *                   through a redirect
 *
 * Nothing secret is returned: the PayGate ID is shown as its last 4 digits.
 */
const crypto = require('crypto');
const paygate = require('./paygate');
const payments = require('./paymentService');
const { paymentsEnabled } = require('../constants/features');

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
    const notifyUrl = payments.notifyUrl();
    const resultUrl = payments.resultPageUrl('').replace(/\?ref=$/, '');

    out.push(paymentsEnabled()
        ? item('switched_on', 'Online payments switched on for the API', 'ok', 'PAYMENTS_ENABLED is on.')
        : item('switched_on', 'Online payments switched on for the API', 'warn', 'PAYMENTS_ENABLED is off: PayGate’s messages about payments would be refused. Set PAYMENTS_ENABLED=true and reload the API.'));

    const configured = !!(c.paygateId && c.password);
    if (!configured) {
        out.push(item('credentials', 'PayGate ID and password', 'fail', 'PAYGATE_ID or PAYGATE_PASSWORD is not set on the server.'));
    } else if (c.paygateId === TEST_PAYGATE_ID) {
        out.push(item('credentials', 'PayGate ID and password', 'warn', `PayGate ID ${lastFour(c.paygateId)} is PayGate’s public test account: no real money moves. Use your own terminal’s PayGate ID to take payments.`));
    } else {
        out.push(item('credentials', 'PayGate ID and password', 'ok', `PayGate ID ${lastFour(c.paygateId)}${process.env.PAYGATE_ENCRYPTION_KEY ? ', with a separate encryption key' : ''}.`));
    }

    const addressProblems = [];
    if (!isHttps(notifyUrl)) addressProblems.push(`PayGate would post results to ${notifyUrl || '(nothing)'}: set PAYGATE_CALLBACK_BASE_URL to the API’s https address`);
    if (!isHttps(resultUrl)) addressProblems.push(`clients would come back to ${resultUrl || '(nothing)'}: set CUSTOMER_APP_URL to the customer site’s https address`);
    out.push(addressProblems.length
        ? item('addresses', 'Addresses PayGate uses', 'fail', `${addressProblems.join('; ')}.`)
        : item('addresses', 'Addresses PayGate uses', 'ok', `Results go to ${notifyUrl}; clients come back to ${resultUrl}.`));

    // 2-4: a real session at PayGate, never paid.
    let session = null;
    if (!configured) {
        out.push(item('session', 'PayGate accepts the ID and password', 'skipped', 'Set the PayGate ID and password first.'));
    } else {
        const reference = `BPCHECK${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
        try {
            const r = await paygate.initiate({
                reference, amountCents: CHECK_AMOUNT_CENTS, currency: payments.ONLINE_CURRENCY,
                customer: { firstName: 'Bookplus', lastName: 'Connection check', email: adminEmail || 'check@bookplus.pro' },
                notifyUrl, returnUrl: payments.returnUrl(),
            });
            if (r.ok) {
                session = { reference, ...r };
                out.push(item('session', 'PayGate accepts the ID and password', 'ok', `PayGate opened a N$${(CHECK_AMOUNT_CENTS / 100).toFixed(2)} test session (${reference}). Nobody pays it; it shows in PayGate’s MAP as not done.`));
            } else {
                out.push(item('session', 'PayGate accepts the ID and password', 'fail', `PayGate said: ${r.error?.message || 'no session'}${r.error?.resultCode ? ` (${r.error.resultCode})` : ''}. Check PAYGATE_ID and PAYGATE_PASSWORD against the terminal’s details, and that the terminal takes N$.`));
            }
        } catch (err) {
            out.push(item('session', 'PayGate accepts the ID and password', 'fail', err.message || 'Could not reach PayGate.'));
        }
    }

    if (!session) {
        out.push(item('signature', 'PayGate signs with the key Bookplus checks', 'skipped', 'Needs a session first.'));
        out.push(item('read_back', 'Bookplus can read a payment’s status from PayGate', 'skipped', 'Needs a session first.'));
    } else {
        if (paygate.verifySessionChecksum(session.fields)) {
            out.push(item('signature', 'PayGate signs with the key Bookplus checks', 'ok', 'Payment results from PayGate will be accepted.'));
        } else {
            const separate = !!process.env.PAYGATE_ENCRYPTION_KEY;
            out.push(item('signature', 'PayGate signs with the key Bookplus checks', 'fail', separate
                ? 'PayGate’s signature does not match PAYGATE_ENCRYPTION_KEY. Copy the terminal’s Encryption Key into it exactly, then reload the API.'
                : 'PayGate accepted the password but signs with a different key, so every payment result would be refused. Set PAYGATE_ENCRYPTION_KEY to the terminal’s Encryption Key, reload the API and check again.'));
        }
        try {
            const q = await paygate.query({ payRequestId: session.payRequestId });
            out.push(q.ok
                ? item('read_back', 'Bookplus can read a payment’s status from PayGate', 'ok', `PayGate reports the test session as ${q.transactionStatusDescription || (q.transactionStatusCode === paygate.TX.NOT_DONE ? 'not done' : `status ${q.transactionStatusCode}`)}.`)
                : item('read_back', 'Bookplus can read a payment’s status from PayGate', 'fail', `PayGate said: ${q.error?.message || 'no answer'}.`));
        } catch (err) {
            out.push(item('read_back', 'Bookplus can read a payment’s status from PayGate', 'fail', err.message || 'Could not reach PayGate.'));
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
                out.push(item('notify', 'PayGate can reach Bookplus', 'fail', `${notifyUrl} answered “not found”: online payments are off on the API, or the address points somewhere else.`));
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
            else if (r.status >= 300 && r.status < 400) out.push(item('result_page', 'The payment result page opens', 'warn', `${resultUrl} redirects to ${r.location || 'another address'}. Set CUSTOMER_APP_URL to the address it ends on, so clients come straight back.`));
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
