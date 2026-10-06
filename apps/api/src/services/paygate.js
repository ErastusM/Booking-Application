/**
 * PayGate PayHost (SOAP 1.1) — the only module that knows PayHost's wire format.
 *
 * Bookplus uses the hosted payment page: we ask PayHost for a payment session
 * (WebPaymentRequest), the browser auto-posts the returned fields to PayGate's
 * page, the client types their card THERE (Bookplus never sees card data — PCI
 * SAQ-A), and PayGate tells us the outcome through the ReturnUrl (browser) and
 * NotifyUrl (server-to-server). Neither callback is trusted on its own: the
 * outcome is always read back with a server-side Query (QueryRequest).
 *
 * Everything here is pure (builders, parser, checksum) except `send`, which goes
 * through an injectable transport so tests never touch the network.
 *
 * Secrets: PAYGATE_PASSWORD is both the PayHost password and the checksum key.
 * It is only ever placed inside the request body sent to PayGate; nothing in
 * this module logs a request body, a password or a checksum.
 */
const https = require('https');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

const NS = 'http://www.paygate.co.za/PayHOST';
const DEFAULT_ENDPOINT = 'https://secure.paygate.co.za/payhost/process.trans';
const TIMEOUT_MS = 20000;

// TRANSACTION_STATUS / TransactionStatusCode values.
const TX = Object.freeze({
    NOT_DONE: 0,
    APPROVED: 1,
    DECLINED: 2,
    CANCELLED: 3,
    USER_CANCELLED: 4,
    RECEIVED: 5, // received by PayGate — still processing
    SETTLEMENT_VOIDED: 7,
});

class PaygateError extends Error {
    constructor(message, { code = 'PAYGATE_ERROR', resultCode = null, resultDescription = null } = {}) {
        super(message);
        this.name = 'PaygateError';
        this.code = code;
        this.resultCode = resultCode;
        this.resultDescription = resultDescription;
    }
}

const config = () => ({
    endpoint: process.env.PAYGATE_ENDPOINT || DEFAULT_ENDPOINT,
    paygateId: process.env.PAYGATE_ID || '',
    password: process.env.PAYGATE_PASSWORD || '',
});
const isConfigured = () => {
    const c = config();
    return !!(c.paygateId && c.password);
};

/* ───────────────────────────── builders ───────────────────────────── */

const xmlEscape = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are not legal XML 1.0 — drop them rather than send a
    // body PayHost will reject.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const el = (name, value) => `<${name}>${xmlEscape(value)}</${name}>`;

const envelope = (inner) => '<?xml version="1.0" encoding="UTF-8"?>'
    + '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">'
    + '<SOAP-ENV:Header/><SOAP-ENV:Body>'
    + inner
    + '</SOAP-ENV:Body></SOAP-ENV:Envelope>';

const accountXml = ({ paygateId, password }) => `<Account>${el('PayGateId', paygateId)}${el('Password', password)}</Account>`;

const assertCents = (amountCents) => {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new PaygateError('Amount must be a positive whole number of cents', { code: 'BAD_AMOUNT' });
    }
};

/**
 * WebPaymentRequest — start a hosted-page payment session.
 * amountCents: integer cents (100 = N$1.00).
 */
const buildWebPaymentRequest = ({
    paygateId, password, reference, amountCents, currency = 'NAD',
    customer = {}, notifyUrl, returnUrl, country = 'NAM', locale = 'en',
}) => {
    assertCents(amountCents);
    const customerXml = `<Customer>${el('FirstName', customer.firstName || '')}${el('LastName', customer.lastName || '')}${el('Email', customer.email || '')}</Customer>`;
    return envelope(
        `<SinglePaymentRequest xmlns="${NS}"><WebPaymentRequest>`
        + accountXml({ paygateId, password })
        + customerXml
        + `<Redirect>${el('NotifyUrl', notifyUrl)}${el('ReturnUrl', returnUrl)}</Redirect>`
        + `<Order>${el('MerchantOrderId', reference)}${el('Currency', currency)}${el('Amount', amountCents)}`
        + `<BillingDetails>${customerXml}<Address>${el('Country', country)}</Address></BillingDetails>`
        + `${el('Locale', locale)}</Order>`
        + '</WebPaymentRequest></SinglePaymentRequest>'
    );
};

/** QueryRequest — read a transaction's current state by its PAY_REQUEST_ID. */
const buildQueryRequest = ({ paygateId, password, payRequestId }) => envelope(
    `<SingleFollowUpRequest xmlns="${NS}"><QueryRequest>`
    + accountXml({ paygateId, password })
    + el('PayRequestId', payRequestId)
    + '</QueryRequest></SingleFollowUpRequest>'
);

/** RefundRequest — refund (part of) a settled transaction by its TransactionId. */
const buildRefundRequest = ({ paygateId, password, transactionId, amountCents }) => {
    assertCents(amountCents);
    return envelope(
        `<SingleFollowUpRequest xmlns="${NS}"><RefundRequest>`
        + accountXml({ paygateId, password })
        + el('TransactionId', transactionId)
        + el('Amount', amountCents)
        + '</RefundRequest></SingleFollowUpRequest>'
    );
};

/* ───────────────────────────── parser ───────────────────────────── */

const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true, // SOAP-ENV:Body / ns2:Status → Body / Status
    parseTagValue: false, // keep every value a string; we convert explicitly
    trimValues: true,
    isArray: (name) => name === 'UrlParams',
});

// null when the body is not XML at all (an HTML error page, a cut-off body).
const parseXml = (xml) => {
    try {
        return parser.parse(String(xml || ''));
    } catch (err) {
        return null;
    }
};
const NOT_XML = { ok: false, error: { code: 'BAD_RESPONSE', message: 'PayGate returned a response that is not XML' } };

// Depth-first search for the first property called `name` (case-insensitive),
// so small differences in nesting between PayHost versions don't break us.
const findKey = (node, name) => {
    if (!node || typeof node !== 'object') return undefined;
    const want = name.toLowerCase();
    const stack = [node];
    while (stack.length) {
        const cur = stack.shift();
        if (!cur || typeof cur !== 'object') continue;
        for (const k of Object.keys(cur)) {
            if (k.toLowerCase() === want) return cur[k];
        }
        for (const k of Object.keys(cur)) {
            if (cur[k] && typeof cur[k] === 'object') stack.push(cur[k]);
        }
    }
    return undefined;
};
const text = (v) => {
    if (v == null) return null;
    if (typeof v === 'object') return v['#text'] != null ? String(v['#text']) : null;
    return String(v);
};
const int = (v) => {
    const s = text(v);
    if (s == null || s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.trunc(n) : null;
};

// A SOAP Fault anywhere in the document → a clean error.
const faultOf = (doc) => {
    const fault = findKey(doc, 'Fault');
    if (!fault) return null;
    return {
        code: text(findKey(fault, 'faultcode')) || 'Fault',
        message: text(findKey(fault, 'faultstring')) || 'PayGate rejected the request',
    };
};

// The fields every Status block may carry, normalised.
const statusOf = (status) => {
    if (!status || typeof status !== 'object') return {};
    const g = (k) => text(findKey(status, k));
    return {
        statusName: g('StatusName'),
        statusDetail: g('StatusDetail'),
        resultCode: g('ResultCode'),
        resultDescription: g('ResultDescription'),
        transactionStatusCode: int(findKey(status, 'TransactionStatusCode')),
        transactionStatusDescription: g('TransactionStatusDescription'),
        transactionId: g('TransactionId'),
        payRequestId: g('PayRequestId'),
        reference: g('Reference'),
        amountCents: int(findKey(status, 'Amount')),
        currency: g('Currency'),
        authCode: g('AuthCode'),
        riskIndicator: g('RiskIndicator'),
        payMethod: text(findKey(findKey(status, 'PaymentType') || {}, 'Method')),
        payMethodDetail: text(findKey(findKey(status, 'PaymentType') || {}, 'Detail')),
    };
};

const isErrorStatus = (s) => /^error$/i.test(s.statusName || '');

/**
 * Parse a WebPaymentResponse.
 * → { ok: true, redirectUrl, fields: {PAYGATE_ID, PAY_REQUEST_ID, REFERENCE, CHECKSUM, …}, payRequestId, status }
 * → { ok: false, error: { code, message, resultCode, resultDescription } }
 */
const parseWebPaymentResponse = (xml) => {
    const doc = parseXml(xml);
    if (!doc) return NOT_XML;
    const fault = faultOf(doc);
    if (fault) return { ok: false, error: { code: 'SOAP_FAULT', message: fault.message, resultCode: fault.code } };
    const resp = findKey(doc, 'WebPaymentResponse') || findKey(doc, 'SinglePaymentResponse');
    if (!resp) return { ok: false, error: { code: 'BAD_RESPONSE', message: 'PayGate did not return a payment session' } };
    const status = statusOf(findKey(resp, 'Status'));
    const redirect = findKey(resp, 'Redirect');
    const redirectUrl = text(findKey(redirect || {}, 'RedirectUrl'));
    let params = findKey(redirect || {}, 'UrlParams') || [];
    if (!Array.isArray(params)) params = [params];
    const fields = {};
    for (const p of params) {
        const key = text(findKey(p, 'key'));
        if (key) fields[key] = text(findKey(p, 'value')) || '';
    }
    if (isErrorStatus(status) || !redirectUrl || !fields.PAY_REQUEST_ID) {
        return {
            ok: false,
            error: {
                code: 'GATEWAY_ERROR',
                message: status.resultDescription || status.statusDetail || 'PayGate could not start the payment',
                resultCode: status.resultCode,
                resultDescription: status.resultDescription,
            },
        };
    }
    return { ok: true, redirectUrl, fields, payRequestId: fields.PAY_REQUEST_ID, status };
};

/**
 * Parse a QueryResponse → { ok: true, ...status } or { ok: false, error }.
 * transactionStatusCode is the number to act on (see TX).
 */
const parseQueryResponse = (xml) => {
    const doc = parseXml(xml);
    if (!doc) return NOT_XML;
    const fault = faultOf(doc);
    if (fault) return { ok: false, error: { code: 'SOAP_FAULT', message: fault.message, resultCode: fault.code } };
    const resp = findKey(doc, 'QueryResponse') || findKey(doc, 'SingleFollowUpResponse');
    const status = statusOf(findKey(resp || {}, 'Status'));
    if (!resp || (isErrorStatus(status) && status.transactionStatusCode == null)) {
        return {
            ok: false,
            error: {
                code: 'GATEWAY_ERROR',
                message: status.resultDescription || 'PayGate could not report on this payment',
                resultCode: status.resultCode,
            },
        };
    }
    return { ok: true, ...status };
};

/**
 * Parse a RefundResponse → { ok: true, ...status } when PayGate accepted it,
 * otherwise { ok: false, error }.
 */
const parseRefundResponse = (xml) => {
    const doc = parseXml(xml);
    if (!doc) return NOT_XML;
    const fault = faultOf(doc);
    if (fault) return { ok: false, error: { code: 'SOAP_FAULT', message: fault.message, resultCode: fault.code } };
    const resp = findKey(doc, 'RefundResponse') || findKey(doc, 'SingleFollowUpResponse');
    const status = statusOf(findKey(resp || {}, 'Status'));
    const approved = status.transactionStatusCode === TX.APPROVED
        || /^completed$/i.test(status.statusName || '');
    if (!resp || isErrorStatus(status) || !approved) {
        return {
            ok: false,
            status,
            error: {
                code: 'REFUND_DECLINED',
                message: status.resultDescription || status.transactionStatusDescription || 'PayGate did not accept the refund',
                resultCode: status.resultCode,
            },
        };
    }
    return { ok: true, ...status };
};

/* ───────────────────────────── checksum ───────────────────────────── */

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

const safeEqualHex = (a, b) => {
    const x = Buffer.from(String(a || '').toLowerCase(), 'utf8');
    const y = Buffer.from(String(b || '').toLowerCase(), 'utf8');
    if (x.length !== y.length || x.length === 0) return false;
    return crypto.timingSafeEqual(x, y);
};

/**
 * Verify a PayGate callback checksum: md5 of every posted value in the order
 * posted (CHECKSUM itself excluded), followed by the key. `pairs` is an ordered
 * list of [name, value] exactly as received, so unknown extra fields are covered.
 */
const verifyPostedChecksum = (pairs, key = config().password) => {
    if (!key || !Array.isArray(pairs)) return false;
    const posted = pairs.find(([k]) => k === 'CHECKSUM');
    if (!posted) return false;
    const concat = pairs.filter(([k]) => k !== 'CHECKSUM').map(([, v]) => v).join('');
    return safeEqualHex(md5(concat + key), posted[1]);
};

/**
 * The PayWeb3 return-page checksum: md5(PAYGATE_ID + PAY_REQUEST_ID +
 * TRANSACTION_STATUS + REFERENCE + key). The return post itself carries only
 * PAY_REQUEST_ID, TRANSACTION_STATUS and CHECKSUM, so the id and reference come
 * from our own records.
 */
const verifyReturnChecksum = ({ paygateId, payRequestId, transactionStatus, reference, checksum }, key = config().password) => {
    if (!key) return false;
    return safeEqualHex(md5(`${paygateId}${payRequestId}${transactionStatus}${reference}${key}`), checksum);
};

/* ───────────────────────────── transport ───────────────────────────── */

// Default transport: one HTTPS POST. Resolves { status, body } for any HTTP
// status (a SOAP Fault comes back as a 500 with a parseable body).
const httpsTransport = ({ endpoint, soapAction, body, timeoutMs = TIMEOUT_MS }) => new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const req = https.request({
        method: 'POST',
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: soapAction,
            'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
    }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
            size += c.length;
            if (size > 1024 * 1024) { req.destroy(new Error('response too large')); return; }
            chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('PayGate request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
});

let transport = httpsTransport;
/** Tests: replace the transport. Pass nothing to restore the real one. */
const setTransport = (fn) => { transport = fn || httpsTransport; };

const send = async (soapAction, body) => {
    const { endpoint } = config();
    let res;
    try {
        res = await transport({ endpoint, soapAction, body });
    } catch (err) {
        // Never echo the body — it carries the password.
        throw new PaygateError(`Could not reach PayGate (${err && err.message ? err.message : 'network error'})`, { code: 'NETWORK' });
    }
    return res && typeof res.body === 'string' ? res.body : String(res?.body || '');
};

const requireConfig = () => {
    const c = config();
    if (!c.paygateId || !c.password) {
        throw new PaygateError('Online payment is not configured', { code: 'NOT_CONFIGURED' });
    }
    return c;
};

/** Start a hosted-page session → parseWebPaymentResponse's shape. */
const initiate = async ({ reference, amountCents, currency, customer, notifyUrl, returnUrl }) => {
    const c = requireConfig();
    const body = buildWebPaymentRequest({ ...c, reference, amountCents, currency, customer, notifyUrl, returnUrl });
    return parseWebPaymentResponse(await send('WebPaymentRequest', body));
};

/** Query a transaction → parseQueryResponse's shape. */
const query = async ({ payRequestId }) => {
    const c = requireConfig();
    return parseQueryResponse(await send('SingleFollowUpRequest', buildQueryRequest({ ...c, payRequestId })));
};

/** Refund (part of) a transaction → parseRefundResponse's shape. */
const refund = async ({ transactionId, amountCents }) => {
    const c = requireConfig();
    return parseRefundResponse(await send('SingleFollowUpRequest', buildRefundRequest({ ...c, transactionId, amountCents })));
};

module.exports = {
    NS, TX, DEFAULT_ENDPOINT, PaygateError,
    config, isConfigured,
    xmlEscape, buildWebPaymentRequest, buildQueryRequest, buildRefundRequest,
    parseWebPaymentResponse, parseQueryResponse, parseRefundResponse,
    md5, verifyPostedChecksum, verifyReturnChecksum,
    setTransport, initiate, query, refund,
};
