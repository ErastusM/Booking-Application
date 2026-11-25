/**
 * PayGate — the only module that knows PayGate's wire formats. Bookplus takes
 * card payments only for business subscriptions, on two terminals:
 *
 *  - tokenize (terminal 1, "One time and tokenization", 3D Secure): PayWeb 3.
 *    The owner pays on PayGate's hosted page: we open a session
 *    (initiate.trans, VAULT=1 so the card is saved), the browser auto-posts
 *    PAY_REQUEST_ID and CHECKSUM to process.trans, the owner types their card
 *    THERE (Bookplus never sees card data — PCI SAQ-A), and PayGate tells us
 *    the outcome through the RETURN_URL (browser) and NOTIFY_URL
 *    (server-to-server). Neither callback is trusted on its own: the outcome
 *    is always read back with a server-side query (query.trans), which also
 *    carries the saved card (VAULT_ID, PAYVAULT_DATA_1/2).
 *  - recurring (terminal 2, "NON3DS"): PayHost (SOAP 1.1). Charging a saved
 *    card each month with nobody present (CardPaymentRequest with the
 *    VaultId), and deleting saved cards (DeleteVaultRequest).
 *
 * Everything here is pure (builders, parsers, checksums) except the transport,
 * which is injectable so tests never touch the network.
 *
 * Secrets: PAYGATE_ENCRYPTION_KEY is terminal 1's PayWeb 3 key (it signs
 * every PayWeb 3 request and answer; PAYGATE_PASSWORD is read as a fallback).
 * PAYGATE_RECURRING_PASSWORD is terminal 2's PayHost key, and
 * PAYGATE_RECURRING_ENCRYPTION_KEY its PayWeb 3 key, which signs its notify
 * posts. Keys are only ever placed inside requests sent to PayGate; nothing in
 * this module logs a request body, a key or a checksum.
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

// The two terminals (docs/PAYMENTS_GO_LIVE.md, section 3), as PayGate set
// them up:
//  - tokenize  terminal 1, "One time and tokenization" (3D Secure), PayWeb 3
//              only: payments where the payer is present (a business's first
//              plan payment or a new card, saved in PayVault). Its PayWeb 3
//              key is PAYGATE_ENCRYPTION_KEY (PAYGATE_PASSWORD as a fallback).
//  - recurring terminal 2, "NON3DS", PayHost: charging a business's saved
//              card each month, with nobody present, and deleting saved cards.
//              PAYGATE_RECURRING_PASSWORD is its PayHost key,
//              PAYGATE_RECURRING_ENCRYPTION_KEY its PayWeb 3 key.
const TERMINALS = Object.freeze({
    tokenize: { protocol: 'payweb3', id: 'PAYGATE_ID', password: 'PAYGATE_PASSWORD', key: 'PAYGATE_ENCRYPTION_KEY' },
    recurring: { protocol: 'payhost', id: 'PAYGATE_RECURRING_ID', password: 'PAYGATE_RECURRING_PASSWORD', key: 'PAYGATE_RECURRING_ENCRYPTION_KEY' },
});
const DEFAULT_PAYWEB_URL = 'https://secure.paygate.co.za/payweb3';
const DEFAULT_TERMINAL = 'tokenize';
const terminalVars = (terminal) => {
    const t = TERMINALS[terminal];
    if (!t) throw new PaygateError(`Unknown PayGate terminal "${terminal}"`, { code: 'BAD_TERMINAL' });
    return t;
};

const config = (terminal = DEFAULT_TERMINAL) => {
    const t = terminalVars(terminal);
    return {
        protocol: t.protocol,
        endpoint: process.env.PAYGATE_ENDPOINT || DEFAULT_ENDPOINT,
        paywebUrl: String(process.env.PAYGATE_PAYWEB_URL || DEFAULT_PAYWEB_URL).replace(/\/+$/, ''),
        paygateId: process.env[t.id] || '',
        password: process.env[t.password] || '',
        // The key PayGate signs callbacks and session fields with. The same as the
        // password unless the terminal's Encryption Key differs from it.
        checksumKey: process.env[t.key] || process.env[t.password] || '',
    };
};
/** Set up on the server: a PayWeb 3 terminal needs its id and key, a PayHost one its id and PayHost key. */
const isConfigured = (terminal = DEFAULT_TERMINAL) => {
    const c = config(terminal);
    return c.protocol === 'payweb3' ? !!(c.paygateId && c.checksumKey) : !!(c.paygateId && c.password);
};

/* ───────────────────────── vault (saved cards, PayVault) ─────────────────────────
 *
 * PayHost saves a card in its vault (PayVault) and returns a token, the
 * VaultId, that later payments use instead of the card. The formats below are
 * PayHost's own (its WSDL, secure.paygate.co.za/payhost/process.trans?wsdl,
 * and docs.paygate.co.za), checked on PayGate's test gateway with its public
 * test account (2026-11-13):
 *
 *   vault        Saving the card with the first payment: <Vault>true</Vault>
 *                after <Customer> in the WebPaymentRequest, and after <Order>
 *                the cardholder-initiated start of a recurring agreement
 *                (<Recurring> InitialAuth, RECURRING, CARD_HOLDER), so the
 *                monthly charges that follow are recognised as such. The
 *                Query answer then carries <VaultId>, <PayVaultData> (cardNumber
 *                masked as 400000xxxxxx0002, expDate as MMYYYY) and the brand in
 *                <PaymentType><Detail>.
 *   charge       The monthly payment: a CardPaymentRequest with the <VaultId>
 *                and <Recurring> RECURRING, MERCHANT (merchant-initiated, no
 *                CVV). PayGate refuses a merchant-initiated charge on a 3D
 *                Secure terminal ("Transaction cant be Merchant Initiated with
 *                3D Enabled Terminal"), so it only runs on terminal "recurring"
 *                (NON3DS). The answer is a CardPaymentResponse Status, read like
 *                a Query's. A Redirect in it (3D Secure asked for) is not a
 *                payment.
 *   deleteVault  A DeleteVaultRequest with the VaultId. PayGate answers
 *                Completed, also for a token already deleted.
 *
 * Still to confirm with PayGate for the live account (its public test account
 * without 3D Secure did not accept the documented password, so it could not be
 * tried): that a token saved on terminal 1 can be charged on terminal 2, and
 * which terminal deletes it (the code deletes on terminal 1).
 *
 * Tests can replace a format with setWire(name, def), mark it not ready with
 * setWire(name, false), and restore PayHost's with setWire(name, null).
 */
const findAll = (node, name) => {
    const hit = findKey(node, name);
    if (hit == null) return [];
    return Array.isArray(hit) ? hit : [hit];
};
const PAYHOST_WIRES = Object.freeze({
    vault: Object.freeze({
        ready: true,
        after: 'Customer',
        requestXml: '<Vault>true</Vault>',
        trailingXml: '<Recurring><InitialAuth>true</InitialAuth><RecurringTransactionType>RECURRING</RecurringTransactionType><InitiatedType>CARD_HOLDER</InitiatedType></Recurring>',
        extract: ({ status }) => {
            const vaultId = text(findKey(status, 'VaultId'));
            if (!vaultId) return null;
            const data = {};
            for (const d of findAll(status, 'PayVaultData')) {
                const k = text(findKey(d, 'name'));
                if (k) data[k] = text(findKey(d, 'value'));
            }
            return {
                vaultId,
                brand: text(findKey(findKey(status, 'PaymentType') || {}, 'Detail')),
                maskedCard: data.cardNumber || null,
                expiry: data.expDate || null,
            };
        },
    }),
    charge: Object.freeze({
        ready: true,
        soapAction: 'SinglePaymentRequest',
        responseElement: 'CardPaymentResponse',
        build: ({ account, vaultId, reference, amountCents, currency, customer = {}, notifyUrl, returnUrl, country = 'NAM', el }) => {
            const person = `<Customer>${el('FirstName', customer.firstName || 'Business')}${el('LastName', customer.lastName || 'Owner')}${el('Email', customer.email || '')}</Customer>`;
            return `<SinglePaymentRequest xmlns="${NS}"><CardPaymentRequest>${account}${person}${el('VaultId', vaultId)}${el('BudgetPeriod', 0)}`
                + (notifyUrl ? `<Redirect>${el('NotifyUrl', notifyUrl)}${el('ReturnUrl', returnUrl || notifyUrl)}</Redirect>` : '')
                + `<Order>${el('MerchantOrderId', reference)}${el('Currency', currency)}${el('Amount', amountCents)}`
                + `<BillingDetails>${person}<Address>${el('Country', country)}</Address></BillingDetails></Order>`
                + '<Recurring><RecurringTransactionType>RECURRING</RecurringTransactionType><InitiatedType>MERCHANT</InitiatedType></Recurring>'
                + '</CardPaymentRequest></SinglePaymentRequest>';
        },
    }),
    deleteVault: Object.freeze({
        ready: true,
        soapAction: 'SingleVaultRequest',
        build: ({ account, vaultId, el }) => `<SingleVaultRequest xmlns="${NS}"><DeleteVaultRequest>${account}${el('VaultId', vaultId)}</DeleteVaultRequest></SingleVaultRequest>`,
    }),
});
const NOT_READY = Object.freeze({ ready: false });
const wires = { ...PAYHOST_WIRES };
const wireReady = (name) => wires[name]?.ready === true;
/** Tests: replace a format ('vault' | 'charge' | 'deleteVault'); false = not ready; nothing = PayHost's. */
const setWire = (name, def) => {
    if (!(name in wires)) throw new PaygateError(`Unknown wire "${name}"`, { code: 'BAD_WIRE' });
    if (def === false) wires[name] = NOT_READY;
    else wires[name] = def ? { ready: true, ...def } : PAYHOST_WIRES[name];
};
const vaultReady = () => wireReady('vault');
const setVaultWire = (def) => setWire('vault', def);
/** Can monthly plan payments run at all: saving, charging and deleting a card are all available. */
const recurringReady = () => wireReady('vault') && wireReady('charge') && wireReady('deleteVault');

const VAULT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');

/**
 * What Bookplus keeps about a saved card: the vault token and a summary to
 * show the owner (brand, last 4 digits, expiry). Never the card number. Pure;
 * null when the token is missing or not token-shaped.
 */
const cardSummary = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const vaultId = String(raw.vaultId || '').trim();
    if (!VAULT_ID_RE.test(vaultId)) return null;
    const last = digits(raw.maskedCard).slice(-4);
    // Expiry as PayGate gives it: MMYYYY, MMYY, MM/YY or MM/YYYY.
    const exp = digits(raw.expiry);
    let expMonth = null;
    let expYear = null;
    if (exp.length === 6 || exp.length === 4) {
        expMonth = Number(exp.slice(0, 2));
        expYear = exp.length === 6 ? Number(exp.slice(2)) : 2000 + Number(exp.slice(2));
        if (expMonth < 1 || expMonth > 12) { expMonth = null; expYear = null; }
    }
    return {
        vaultId,
        brand: String(raw.brand || '').replace(/[^A-Za-z .-]/g, '').trim().slice(0, 30) || null,
        last4: last.length === 4 ? last : null,
        expMonth,
        expYear,
    };
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
    customer = {}, notifyUrl, returnUrl, country = 'NAM', locale = 'en', vault = false,
}) => {
    assertCents(amountCents);
    if (vault && !vaultReady()) {
        throw new PaygateError('Saving a card is not available yet', { code: 'VAULT_NOT_READY' });
    }
    const customerXml = `<Customer>${el('FirstName', customer.firstName || '')}${el('LastName', customer.lastName || '')}${el('Email', customer.email || '')}</Customer>`;
    const parts = [
        ['Account', accountXml({ paygateId, password })],
        ['Customer', customerXml],
        ['Redirect', `<Redirect>${el('NotifyUrl', notifyUrl)}${el('ReturnUrl', returnUrl)}</Redirect>`],
        ['Order', `<Order>${el('MerchantOrderId', reference)}${el('Currency', currency)}${el('Amount', amountCents)}`
            + `<BillingDetails>${customerXml}<Address>${el('Country', country)}</Address></BillingDetails>`
            + `${el('Locale', locale)}</Order>`],
    ];
    if (vault) {
        const vaultWire = wires.vault;
        const at = parts.findIndex(([name]) => name === vaultWire.after);
        if (at < 0 || !vaultWire.requestXml) throw new PaygateError('Saving a card is not available yet', { code: 'VAULT_NOT_READY' });
        parts.splice(at + 1, 0, ['Vault', vaultWire.requestXml]);
        // After Order (WebPaymentRequestType's sequence ends with Recurring).
        if (vaultWire.trailingXml) parts.push(['VaultTrailing', vaultWire.trailingXml]);
    }
    return envelope(
        `<SinglePaymentRequest xmlns="${NS}"><WebPaymentRequest>`
        + parts.map(([, xml]) => xml).join('')
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

// "Error", and "ValidationError" for a request PayHost's schema refused.
const isErrorStatus = (s) => /error$/i.test(s.statusName || '');

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
    const statusNode = findKey(resp || {}, 'Status');
    const status = statusOf(statusNode);
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
    // The saved card, when the vault wire format is known (see the vault section).
    return { ok: true, ...status, vault: vaultOf(statusNode) };
};

// The saved card in a Status block, when the vault wire format is known.
const vaultOf = (statusNode) => {
    if (!vaultReady() || typeof wires.vault.extract !== 'function') return null;
    // (A VaultId can be present before the payment is approved: callers only use it once it is.)
    try { return wires.vault.extract({ status: statusNode || {} }) || null; } catch (err) { return null; }
};

/**
 * Parse the answer to a saved-card charge → { ok: true, ...status } (act on
 * transactionStatusCode, as for a Query) or { ok: false, error }.
 */
const parseChargeResponse = (xml) => {
    const doc = parseXml(xml);
    if (!doc) return NOT_XML;
    const fault = faultOf(doc);
    if (fault) return { ok: false, error: { code: 'SOAP_FAULT', message: fault.message, resultCode: fault.code } };
    const resp = findKey(doc, wires.charge.responseElement || 'CardPaymentResponse') || findKey(doc, 'SinglePaymentResponse');
    const status = statusOf(findKey(resp || {}, 'Status'));
    // 3D Secure asked for: nobody is there to answer it, so nothing is charged.
    if (resp && findKey(resp, 'RedirectUrl')) {
        return { ok: false, error: { code: 'NEEDS_3DS', message: 'PayGate asked for 3D Secure on a saved-card charge', resultCode: status.resultCode } };
    }
    // An Error (or ValidationError) status is a refusal: nothing was charged,
    // even when it carries TransactionStatusCode 0 ("Not Done").
    if (!resp || status.transactionStatusCode == null || isErrorStatus(status)) {
        return {
            ok: false,
            error: {
                code: 'GATEWAY_ERROR',
                message: status.resultDescription || status.statusDetail || 'PayGate could not charge the saved card',
                resultCode: status.resultCode,
            },
        };
    }
    return { ok: true, ...status };
};

/** Parse the answer to deleting a saved card → { ok: true } or { ok: false, error }. */
const parseDeleteVaultResponse = (xml) => {
    const doc = parseXml(xml);
    if (!doc) return NOT_XML;
    const fault = faultOf(doc);
    if (fault) return { ok: false, error: { code: 'SOAP_FAULT', message: fault.message, resultCode: fault.code } };
    const status = statusOf(findKey(doc, 'Status'));
    if (!findKey(doc, 'Status') || isErrorStatus(status)) {
        return { ok: false, error: { code: 'GATEWAY_ERROR', message: status.resultDescription || 'PayGate did not delete the saved card', resultCode: status.resultCode } };
    }
    return { ok: true };
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
const verifyPostedChecksum = (pairs, key = config().checksumKey) => {
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
const verifyReturnChecksum = ({ paygateId, payRequestId, transactionStatus, reference, checksum }, key = config().checksumKey) => {
    if (!key) return false;
    return safeEqualHex(md5(`${paygateId}${payRequestId}${transactionStatus}${reference}${key}`), checksum);
};

/**
 * The checksum PayGate puts on a new session's fields: md5(PAYGATE_ID +
 * PAY_REQUEST_ID + REFERENCE + key). Bookplus doesn't need it to take a
 * payment; the connection check uses it to prove which key PayGate signs with.
 */
const verifySessionChecksum = (fields, key = config().checksumKey) => {
    if (!key || !fields) return false;
    return safeEqualHex(md5(`${fields.PAYGATE_ID || ''}${fields.PAY_REQUEST_ID || ''}${fields.REFERENCE || ''}${key}`), fields.CHECKSUM);
};

/* ───────────────────────────── PayWeb 3 (terminal 1) ─────────────────────────────
 *
 * Checked on PayGate's test gateway with its public test account
 * (10011072130, key "secret"), 2026-11-25:
 *   initiate.trans  PAYGATE_ID, REFERENCE, AMOUNT (cents), CURRENCY,
 *                   RETURN_URL, TRANSACTION_DATE, LOCALE, COUNTRY, EMAIL,
 *                   NOTIFY_URL, VAULT=1, CHECKSUM = md5(the values in that
 *                   order + key). Answer: PAYGATE_ID, PAY_REQUEST_ID,
 *                   REFERENCE, CHECKSUM = md5(those three + key); or ERROR=…
 *   process.trans   the browser posts PAY_REQUEST_ID and CHECKSUM.
 *   query.trans     PAYGATE_ID, PAY_REQUEST_ID, REFERENCE, CHECKSUM. Answer:
 *                   TRANSACTION_STATUS, RESULT_CODE, AUTH_CODE, CURRENCY,
 *                   AMOUNT, RESULT_DESC, TRANSACTION_ID, RISK_INDICATOR,
 *                   PAY_METHOD, PAY_METHOD_DETAIL (the brand), VAULT_ID,
 *                   PAYVAULT_DATA_1 (400000xxxxxx0002), PAYVAULT_DATA_2
 *                   (MMYYYY), CHECKSUM = md5(every value in order + key).
 * A card can be saved even when the payment is not approved: the VAULT_ID is
 * only kept once it is (subscriptionBilling deletes the others).
 */

const pad2 = (n) => String(n).padStart(2, '0');
/** PayWeb 3's TRANSACTION_DATE: "YYYY-MM-DD HH:mm:ss" (UTC). */
const paywebDate = (d = new Date()) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;

/** Sign ordered [name, value] pairs: md5 of the values in order, then the key. */
const signPairs = (pairs, key) => [...pairs, ['CHECKSUM', md5(pairs.map(([, v]) => String(v)).join('') + key)]];

/** The initiate.trans request, as ordered pairs (CHECKSUM last). */
const buildPayWebInitiate = ({
    paygateId, key, reference, amountCents, currency = 'NAD', returnUrl, notifyUrl, email = '',
    country = 'NAM', locale = 'en-za', vault = true, now = new Date(),
}) => {
    assertCents(amountCents);
    const pairs = [
        ['PAYGATE_ID', paygateId], ['REFERENCE', reference], ['AMOUNT', String(amountCents)], ['CURRENCY', currency],
        ['RETURN_URL', returnUrl], ['TRANSACTION_DATE', paywebDate(now)], ['LOCALE', locale], ['COUNTRY', country],
        ['EMAIL', email], ['NOTIFY_URL', notifyUrl],
    ];
    if (vault) pairs.push(['VAULT', '1']);
    return signPairs(pairs, key);
};

/** The query.trans request, as ordered pairs. */
const buildPayWebQuery = ({ paygateId, key, payRequestId, reference }) => signPairs(
    [['PAYGATE_ID', paygateId], ['PAY_REQUEST_ID', payRequestId], ['REFERENCE', reference]], key,
);

const formPairs = (body) => {
    const out = [];
    for (const [k, v] of new URLSearchParams(String(body || '').trim())) out.push([k, v]);
    return out;
};
const pairValue = (pairs, name) => (pairs.find(([k]) => k === name) || [])[1];

/**
 * Parse initiate.trans's answer. PayGate signs it with the terminal's key; an
 * answer that doesn't verify is refused (results signed with another key
 * would all be rejected later).
 * → { ok: true, redirectUrl, fields: { PAY_REQUEST_ID, CHECKSUM }, payRequestId, reference, session }
 * → { ok: false, error: { code, message, resultCode } }
 */
const parsePayWebInitiate = (body, { key, paywebUrl = DEFAULT_PAYWEB_URL } = {}) => {
    const pairs = formPairs(body);
    const error = pairValue(pairs, 'ERROR');
    if (error) {
        const known = {
            DATA_CHK: 'the checksum did not match: check the terminal’s PayWeb 3 key',
            PGID_NOT_EN: 'this PayGate ID is not enabled for PayWeb 3',
            DATA_PAY_REQ_ID: 'the request was refused',
        };
        return { ok: false, error: { code: 'GATEWAY_ERROR', message: known[error] ? `PayGate refused it: ${known[error]}` : `PayGate refused it (${error})`, resultCode: error } };
    }
    const session = Object.fromEntries(pairs);
    if (!session.PAY_REQUEST_ID || !session.CHECKSUM) {
        return { ok: false, error: { code: 'BAD_RESPONSE', message: 'PayGate did not return a payment session' } };
    }
    if (!verifySessionChecksum(session, key)) {
        return { ok: false, error: { code: 'BAD_CHECKSUM', message: 'PayGate’s answer was not signed with the key Bookplus has for this terminal' } };
    }
    return {
        ok: true,
        redirectUrl: `${paywebUrl}/process.trans`,
        // Exactly what the browser posts to PayGate's page.
        fields: { PAY_REQUEST_ID: session.PAY_REQUEST_ID, CHECKSUM: session.CHECKSUM },
        payRequestId: session.PAY_REQUEST_ID,
        reference: session.REFERENCE || null,
        session,
    };
};

const STATUS_TEXT = ['Not Done', 'Approved', 'Declined', 'Cancelled', 'User Cancelled', 'Received by PayGate', null, 'Settlement Voided'];

/**
 * Parse query.trans's answer into the same shape as a PayHost Query
 * (transactionStatusCode is the number to act on, see TX), with the saved
 * card in `vault`. The answer must verify against the terminal's key.
 */
const parsePayWebQuery = (body, { key } = {}) => {
    const pairs = formPairs(body);
    const error = pairValue(pairs, 'ERROR');
    if (error) return { ok: false, error: { code: 'GATEWAY_ERROR', message: `PayGate could not report on this payment (${error})`, resultCode: error } };
    if (!pairValue(pairs, 'CHECKSUM') || !verifyPostedChecksum(pairs, key)) {
        return { ok: false, error: { code: 'BAD_CHECKSUM', message: 'PayGate’s answer was not signed with the key Bookplus has for this terminal' } };
    }
    const g = (k) => {
        const v = pairValue(pairs, k);
        return v == null || v === '' ? null : v;
    };
    const code = int(g('TRANSACTION_STATUS'));
    if (code == null) return { ok: false, error: { code: 'BAD_RESPONSE', message: 'PayGate did not report a status for this payment' } };
    const vaultId = g('VAULT_ID');
    return {
        ok: true,
        statusName: 'Completed',
        transactionStatusCode: code,
        transactionStatusDescription: STATUS_TEXT[code] || null,
        resultCode: g('RESULT_CODE'),
        resultDescription: g('RESULT_DESC'),
        transactionId: g('TRANSACTION_ID'),
        payRequestId: g('PAY_REQUEST_ID'),
        reference: g('REFERENCE'),
        amountCents: int(g('AMOUNT')),
        currency: g('CURRENCY'),
        authCode: g('AUTH_CODE'),
        riskIndicator: g('RISK_INDICATOR'),
        payMethod: g('PAY_METHOD'),
        payMethodDetail: g('PAY_METHOD_DETAIL'),
        vault: vaultId ? { vaultId, brand: g('PAY_METHOD_DETAIL'), maskedCard: g('PAYVAULT_DATA_1'), expiry: g('PAYVAULT_DATA_2') } : null,
    };
};

/* ───────────────────────────── transport ───────────────────────────── */

// Default transport: one HTTPS POST. Resolves { status, body } for any HTTP
// status (a SOAP Fault comes back as a 500 with a parseable body).
const httpsTransport = ({ endpoint, soapAction, body, contentType = 'text/xml; charset=utf-8', timeoutMs = TIMEOUT_MS }) => new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const req = https.request({
        method: 'POST',
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        headers: {
            'Content-Type': contentType,
            ...(soapAction ? { SOAPAction: soapAction } : {}),
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

const requireConfig = (terminal = DEFAULT_TERMINAL) => {
    if (!isConfigured(terminal)) {
        throw new PaygateError('Online payment is not configured', { code: 'NOT_CONFIGURED' });
    }
    return config(terminal);
};

/** One PayWeb 3 form post → the answer's body. */
const sendForm = async (url, pairs) => {
    let res;
    try {
        res = await transport({ endpoint: url, body: new URLSearchParams(pairs).toString(), contentType: 'application/x-www-form-urlencoded' });
    } catch (err) {
        // Never echo the body — it carries the checksum.
        throw new PaygateError(`Could not reach PayGate (${err && err.message ? err.message : 'network error'})`, { code: 'NETWORK' });
    }
    return res && typeof res.body === 'string' ? res.body : String(res?.body || '');
};

/**
 * Start a hosted-page session → { ok, redirectUrl, fields, payRequestId, reference? }
 * or { ok: false, error }. On terminal 1 (PayWeb 3) the card is always saved
 * (VAULT=1); on a PayHost terminal only with `vault`.
 */
const initiate = async ({ reference, amountCents, currency, customer = {}, notifyUrl, returnUrl, terminal = DEFAULT_TERMINAL, vault = false, now = new Date() }) => {
    const c = requireConfig(terminal);
    if (c.protocol === 'payweb3') {
        const pairs = buildPayWebInitiate({
            paygateId: c.paygateId, key: c.checksumKey, reference, amountCents, currency, returnUrl, notifyUrl, email: customer.email || '', vault: true, now,
        });
        return parsePayWebInitiate(await sendForm(`${c.paywebUrl}/initiate.trans`, pairs), { key: c.checksumKey, paywebUrl: c.paywebUrl });
    }
    const body = buildWebPaymentRequest({ ...c, reference, amountCents, currency, customer, notifyUrl, returnUrl, vault });
    return parseWebPaymentResponse(await send('WebPaymentRequest', body));
};

/** Query a transaction → { ok, transactionStatusCode, …, vault } (PayWeb 3 needs our reference). */
const query = async ({ payRequestId, reference, terminal = DEFAULT_TERMINAL }) => {
    const c = requireConfig(terminal);
    if (c.protocol === 'payweb3') {
        const pairs = buildPayWebQuery({ paygateId: c.paygateId, key: c.checksumKey, payRequestId, reference: reference || '' });
        return parsePayWebQuery(await sendForm(`${c.paywebUrl}/query.trans`, pairs), { key: c.checksumKey });
    }
    return parseQueryResponse(await send('SingleFollowUpRequest', buildQueryRequest({ ...c, payRequestId })));
};

/**
 * Does PayHost accept this terminal's id and PayHost key? Asks about a
 * transaction that cannot exist: PayHost answers 401 ("Requested Transaction
 * Does Not Exist") when the login is right and 11 ("Incorrect Credentials
 * Supplied") when it is not. Nothing is charged. → { ok, resultCode, message }
 */
const checkPayHostLogin = async (terminal = 'recurring') => {
    const c = requirePayHost(terminal);
    const q = parseQueryResponse(await send('SingleFollowUpRequest', buildQueryRequest({ ...c, payRequestId: '00000000-0000-0000-0000-000000000000' })));
    const resultCode = q.resultCode || q.error?.resultCode || null;
    if (String(resultCode) === '11') return { ok: false, resultCode, message: q.resultDescription || 'Incorrect Credentials Supplied' };
    if (q.ok && String(resultCode) === '401') return { ok: true, resultCode, message: q.resultDescription };
    return { ok: false, resultCode, message: q.resultDescription || q.error?.message || 'PayHost gave an unexpected answer' };
};

/** A PayHost-only operation on a PayWeb 3 terminal: refused before anything is sent. */
const requirePayHost = (terminal) => {
    const c = requireConfig(terminal);
    if (c.protocol !== 'payhost') throw new PaygateError(`Terminal "${terminal}" uses PayWeb 3, not PayHost`, { code: 'NOT_PAYHOST' });
    return c;
};

/** Refund (part of) a transaction on a PayHost terminal → parseRefundResponse's shape. */
const refund = async ({ transactionId, amountCents, terminal = 'recurring' }) => {
    const c = requirePayHost(terminal);
    return parseRefundResponse(await send('SingleFollowUpRequest', buildRefundRequest({ ...c, transactionId, amountCents })));
};

const requireWire = (name) => {
    if (!wireReady(name)) throw new PaygateError('Saved cards are not available yet', { code: 'VAULT_NOT_READY' });
    return wires[name];
};

/**
 * Charge a saved card with nobody present (terminal "recurring" by default)
 * → parseChargeResponse's shape. Throws PaygateError (NOT_CONFIGURED,
 * VAULT_NOT_READY, BAD_AMOUNT, NETWORK); on NETWORK the outcome is UNKNOWN.
 */
const chargeVault = async ({ vaultId, reference, amountCents, currency = 'NAD', customer = {}, notifyUrl, returnUrl, terminal = 'recurring' }) => {
    const wire = requireWire('charge');
    assertCents(amountCents);
    if (!VAULT_ID_RE.test(String(vaultId || ''))) throw new PaygateError('No saved card', { code: 'NO_VAULT' });
    const c = requirePayHost(terminal);
    const body = envelope(wire.build({ account: accountXml(c), vaultId, reference, amountCents, currency, customer, notifyUrl, returnUrl, el }));
    return parseChargeResponse(await send(wire.soapAction || 'SinglePaymentRequest', body));
};

/** Ask PayHost to delete a saved card (terminal 2: terminal 1 has no PayHost) → { ok }. */
const deleteVault = async ({ vaultId, terminal = 'recurring' }) => {
    const wire = requireWire('deleteVault');
    if (!VAULT_ID_RE.test(String(vaultId || ''))) throw new PaygateError('No saved card', { code: 'NO_VAULT' });
    const c = requirePayHost(terminal);
    return parseDeleteVaultResponse(await send(wire.soapAction || 'SingleVaultRequest', envelope(wire.build({ account: accountXml(c), vaultId, el }))));
};

module.exports = {
    NS, TX, DEFAULT_ENDPOINT, PaygateError,
    TERMINALS, DEFAULT_TERMINAL, config, isConfigured,
    vaultReady, setVaultWire, setWire, wireReady, recurringReady, cardSummary,
    xmlEscape, buildWebPaymentRequest, buildQueryRequest, buildRefundRequest,
    parseWebPaymentResponse, parseQueryResponse, parseRefundResponse, parseChargeResponse, parseDeleteVaultResponse,
    DEFAULT_PAYWEB_URL, paywebDate, buildPayWebInitiate, buildPayWebQuery, parsePayWebInitiate, parsePayWebQuery,
    md5, verifyPostedChecksum, verifyReturnChecksum, verifySessionChecksum,
    setTransport, initiate, query, refund, chargeVault, deleteVault, checkPayHostLogin,
};
