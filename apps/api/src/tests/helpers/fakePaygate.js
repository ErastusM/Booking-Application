/**
 * A fake PayGate PayHost for integration tests, plugged in through
 * paygate.setTransport(). It answers WebPaymentRequest / QueryRequest /
 * RefundRequest with real-shaped SOAP, and lets a test decide what PayGate
 * "knows" about each transaction.
 */
const crypto = require('crypto');
const paygate = require('../../services/paygate');

const PAYGATE_ID = '10011072130';
const KEY = 'test-paygate-key';
// Terminal 2 ("NON3DS"), charging saved cards each month.
const RECURRING_ID = '10011099999';
const RECURRING_KEY = 'test-recurring-key';
const KEY_FOR = { [PAYGATE_ID]: KEY, [RECURRING_ID]: RECURRING_KEY };

/**
 * A made-up vault wire format for tests (paygate.setVaultWire). The element
 * names are deliberately NOT PayHost's: the real ones are to be filled in from
 * PayGate's documentation, and nothing here should be mistaken for them.
 */
const TEST_VAULT_WIRE = Object.freeze({
    after: 'Customer',
    requestXml: '<TestSaveCard>true</TestSaveCard>',
    extract: ({ status }) => (status.TestVaultId ? {
        vaultId: status.TestVaultId,
        brand: status.PaymentType?.Detail,
        maskedCard: status.TestMaskedCard,
        expiry: status.TestExpiry,
    } : null),
});

/** Made-up formats for charging and deleting a saved card (paygate.setWire), same rule. */
const TEST_CHARGE_WIRE = Object.freeze({
    soapAction: 'TestCharge',
    responseElement: 'TestChargeResponse',
    build: ({ account, vaultId, reference, amountCents, currency, el }) => `<TestChargeCard>${account}${el('TestVaultId', vaultId)}${el('MerchantOrderId', reference)}${el('Currency', currency)}${el('Amount', amountCents)}</TestChargeCard>`,
});
const TEST_DELETE_WIRE = Object.freeze({
    soapAction: 'TestDelete',
    build: ({ account, vaultId, el }) => `<TestDeleteCard>${account}${el('TestVaultId', vaultId)}</TestDeleteCard>`,
});

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const tag = (body, name) => (body.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1];

const soap = (inner) => `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns2="http://www.paygate.co.za/PayHOST"><SOAP-ENV:Body>${inner}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const createFakePaygate = () => {
    let n = 0;
    const gw = {
        // payRequestId → { reference, amountCents, currency, code, amountOverride?, currencyOverride? }
        tx: new Map(),
        calls: [],
        initFail: false,
        refundFail: false,
        // Saved-card charges: the TransactionStatusCode PayGate answers with
        // (1 approved, 2 declined, 5 received / still processing), per vault id
        // or for all; 'network' = PayGate unreachable mid-request, 'error' = an
        // Error status with no transaction.
        chargeOutcome: 1,
        chargeOutcomeFor: new Map(),
        deleteFail: false,
        deleted: [],
        byReference(reference) {
            for (const [id, t] of gw.tx) if (t.reference === reference) return { payRequestId: id, ...t };
            return null;
        },
        // What a later Query will say about this payment.
        setStatus(reference, code, extra = {}) {
            const hit = gw.byReference(reference);
            if (!hit) throw new Error(`no fake transaction for ${reference}`);
            Object.assign(gw.tx.get(hit.payRequestId), { code }, extra);
        },
        install() {
            process.env.PAYGATE_ID = PAYGATE_ID;
            process.env.PAYGATE_PASSWORD = KEY;
            process.env.PAYGATE_RECURRING_ID = RECURRING_ID;
            process.env.PAYGATE_RECURRING_PASSWORD = RECURRING_KEY;
            paygate.setTransport(gw.transport);
        },
        /** Describe the (made-up) vault wire formats (save, charge, delete), or remove them: install() first. */
        useVault(on = true) {
            paygate.setVaultWire(on ? TEST_VAULT_WIRE : null);
            paygate.setWire('charge', on ? TEST_CHARGE_WIRE : null);
            paygate.setWire('deleteVault', on ? TEST_DELETE_WIRE : null);
        },
        uninstall() {
            paygate.setTransport();
            paygate.setVaultWire(null);
            paygate.setWire('charge', null);
            paygate.setWire('deleteVault', null);
            delete process.env.PAYGATE_RECURRING_ID;
            delete process.env.PAYGATE_RECURRING_PASSWORD;
        },
        reset() {
            gw.tx.clear(); gw.calls.length = 0; gw.initFail = false; gw.refundFail = false;
            gw.chargeOutcome = 1; gw.chargeOutcomeFor.clear(); gw.deleteFail = false; gw.deleted.length = 0;
        },
        charges() { return gw.calls.filter((c) => c.body.includes('<TestChargeCard>')); },
        async transport({ soapAction, body }) {
            gw.calls.push({ soapAction, body });
            if (body.includes('<WebPaymentRequest>')) {
                if (gw.initFail) {
                    return { status: 500, body: soap('<SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring>Service unavailable</faultstring></SOAP-ENV:Fault>') };
                }
                n += 1;
                const payRequestId = `PR-${String(n).padStart(4, '0')}-${crypto.randomBytes(4).toString('hex')}`;
                const reference = tag(body, 'MerchantOrderId');
                const terminalId = tag(body, 'PayGateId') || PAYGATE_ID;
                gw.tx.set(payRequestId, {
                    reference, amountCents: Number(tag(body, 'Amount')), currency: tag(body, 'Currency'), code: 0, transactionId: String(18690000 + n),
                    terminalId, saveCard: body.includes('<TestSaveCard>true</TestSaveCard>'),
                });
                const params = [['PAYGATE_ID', terminalId], ['PAY_REQUEST_ID', payRequestId], ['REFERENCE', reference]];
                params.push(['CHECKSUM', md5(params.map(([, v]) => v).join('') + (KEY_FOR[terminalId] || KEY))]);
                return {
                    status: 200,
                    body: soap(`<ns2:SinglePaymentResponse><ns2:WebPaymentResponse><ns2:Redirect><ns2:RedirectUrl>https://secure.paygate.co.za/payweb3/process.trans</ns2:RedirectUrl>${params.map(([k, v]) => `<ns2:UrlParams><ns2:key>${k}</ns2:key><ns2:value>${v}</ns2:value></ns2:UrlParams>`).join('')}</ns2:Redirect><ns2:Status><ns2:StatusName>Completed</ns2:StatusName></ns2:Status></ns2:WebPaymentResponse></ns2:SinglePaymentResponse>`),
                };
            }
            if (body.includes('<TestChargeCard>')) {
                const vaultId = tag(body, 'TestVaultId');
                const outcome = gw.chargeOutcomeFor.has(vaultId) ? gw.chargeOutcomeFor.get(vaultId) : gw.chargeOutcome;
                if (outcome === 'network') throw new Error('socket hang up');
                if (outcome === 'error') {
                    return { status: 200, body: soap('<ns2:TestChargeResponse><ns2:Status><ns2:StatusName>Error</ns2:StatusName><ns2:ResultCode>900014</ns2:ResultCode><ns2:ResultDescription>Invalid vault</ns2:ResultDescription></ns2:Status></ns2:TestChargeResponse>') };
                }
                n += 1;
                const payRequestId = `PR-${String(n).padStart(4, '0')}-${crypto.randomBytes(4).toString('hex')}`;
                const t = {
                    reference: tag(body, 'MerchantOrderId'), amountCents: Number(tag(body, 'Amount')), currency: tag(body, 'Currency'),
                    code: outcome, transactionId: String(18690000 + n), terminalId: tag(body, 'PayGateId'), vaultId,
                };
                gw.tx.set(payRequestId, t);
                return {
                    status: 200,
                    body: soap(`<ns2:TestChargeResponse><ns2:Status><ns2:TransactionId>${t.transactionId}</ns2:TransactionId><ns2:Reference>${t.reference}</ns2:Reference><ns2:StatusName>Completed</ns2:StatusName><ns2:PayRequestId>${payRequestId}</ns2:PayRequestId><ns2:TransactionStatusCode>${t.code}</ns2:TransactionStatusCode><ns2:ResultCode>${t.code === 1 ? '990017' : '900003'}</ns2:ResultCode><ns2:ResultDescription>${t.code === 1 ? 'Auth Done' : 'Insufficient Funds'}</ns2:ResultDescription><ns2:Currency>${t.currency}</ns2:Currency><ns2:Amount>${t.amountCents}</ns2:Amount></ns2:Status></ns2:TestChargeResponse>`),
                };
            }
            if (body.includes('<TestDeleteCard>')) {
                if (gw.deleteFail) return { status: 200, body: soap('<ns2:TestDeleteResponse><ns2:Status><ns2:StatusName>Error</ns2:StatusName><ns2:ResultDescription>Try later</ns2:ResultDescription></ns2:Status></ns2:TestDeleteResponse>') };
                gw.deleted.push(tag(body, 'TestVaultId'));
                return { status: 200, body: soap('<ns2:TestDeleteResponse><ns2:Status><ns2:StatusName>Completed</ns2:StatusName></ns2:Status></ns2:TestDeleteResponse>') };
            }
            if (body.includes('<QueryRequest>')) {
                const id = tag(body, 'PayRequestId');
                const t = gw.tx.get(id);
                if (!t) return { status: 200, body: soap('<ns2:SingleFollowUpResponse><ns2:QueryResponse><ns2:Status><ns2:StatusName>Error</ns2:StatusName><ns2:ResultCode>900001</ns2:ResultCode></ns2:Status></ns2:QueryResponse></ns2:SingleFollowUpResponse>') };
                return {
                    status: 200,
                    body: soap(`<ns2:SingleFollowUpResponse><ns2:QueryResponse><ns2:Status><ns2:TransactionId>${t.transactionId}</ns2:TransactionId><ns2:Reference>${t.referenceOverride || t.reference}</ns2:Reference><ns2:StatusName>Completed</ns2:StatusName><ns2:PayRequestId>${id}</ns2:PayRequestId><ns2:TransactionStatusCode>${t.code}</ns2:TransactionStatusCode><ns2:TransactionStatusDescription>${['Not Done', 'Approved', 'Declined', 'Cancelled', 'User Cancelled', 'Received by PayGate'][t.code] || 'Unknown'}</ns2:TransactionStatusDescription><ns2:ResultCode>${t.code === 1 ? '990017' : '900003'}</ns2:ResultCode><ns2:ResultDescription>${t.code === 1 ? 'Auth Done' : 'Insufficient Funds'}</ns2:ResultDescription><ns2:Currency>${t.currencyOverride || t.currency}</ns2:Currency><ns2:Amount>${t.amountOverride ?? t.amountCents}</ns2:Amount><ns2:PaymentType><ns2:Method>CC</ns2:Method><ns2:Detail>Visa</ns2:Detail></ns2:PaymentType>${t.saveCard && t.code === 1 && !t.noVault ? `<ns2:TestVaultId>${t.vaultId || 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff'}</ns2:TestVaultId><ns2:TestMaskedCard>${t.masked || '400000xxxxxx0002'}</ns2:TestMaskedCard><ns2:TestExpiry>122030</ns2:TestExpiry>` : ''}</ns2:Status></ns2:QueryResponse></ns2:SingleFollowUpResponse>`),
                };
            }
            if (body.includes('<RefundRequest>')) {
                if (gw.refundFail) {
                    return { status: 200, body: soap('<ns2:SingleFollowUpResponse><ns2:RefundResponse><ns2:Status><ns2:StatusName>Error</ns2:StatusName><ns2:ResultCode>900209</ns2:ResultCode><ns2:ResultDescription>Refund not possible right now</ns2:ResultDescription></ns2:Status></ns2:RefundResponse></ns2:SingleFollowUpResponse>') };
                }
                n += 1;
                return {
                    status: 200,
                    body: soap(`<ns2:SingleFollowUpResponse><ns2:RefundResponse><ns2:Status><ns2:TransactionId>${29990000 + n}</ns2:TransactionId><ns2:StatusName>Completed</ns2:StatusName><ns2:TransactionStatusCode>1</ns2:TransactionStatusCode><ns2:ResultCode>990017</ns2:ResultCode><ns2:Currency>NAD</ns2:Currency><ns2:Amount>${tag(body, 'Amount')}</ns2:Amount></ns2:Status></ns2:RefundResponse></ns2:SingleFollowUpResponse>`),
                };
            }
            return { status: 500, body: 'unexpected' };
        },
        /** A notify post body, in PayGate's field order, with a valid (or broken) checksum. */
        notifyBody(reference, { status, checksumKey, tamper } = {}) {
            const hit = gw.byReference(reference);
            const terminalId = hit.terminalId || PAYGATE_ID;
            checksumKey = checksumKey ?? (KEY_FOR[terminalId] || KEY); // eslint-disable-line no-param-reassign
            const fields = [
                ['PAYGATE_ID', terminalId], ['PAY_REQUEST_ID', hit.payRequestId], ['REFERENCE', reference],
                ['TRANSACTION_STATUS', String(status ?? hit.code)], ['RESULT_CODE', '990017'], ['AUTH_CODE', 'X1Y2Z3'],
                ['CURRENCY', hit.currency], ['AMOUNT', String(hit.amountCents)], ['RESULT_DESC', 'Auth Done'],
                ['TRANSACTION_ID', hit.transactionId], ['RISK_INDICATOR', 'AX'], ['PAY_METHOD', 'CC'], ['PAY_METHOD_DETAIL', 'Visa'],
            ];
            const checksum = md5(fields.map(([, v]) => v).join('') + checksumKey);
            const all = [...fields, ['CHECKSUM', checksum]];
            if (tamper) all[7][1] = '1';
            return new URLSearchParams(all).toString();
        },
        /** A return post body (PayWeb3 checksum). */
        returnBody(reference, { status, checksumKey } = {}) {
            const hit = gw.byReference(reference);
            const st = String(status ?? hit.code);
            const terminalId = hit.terminalId || PAYGATE_ID;
            const checksum = md5(`${terminalId}${hit.payRequestId}${st}${reference}${checksumKey ?? (KEY_FOR[terminalId] || KEY)}`);
            return new URLSearchParams([['PAY_REQUEST_ID', hit.payRequestId], ['TRANSACTION_STATUS', st], ['CHECKSUM', checksum]]).toString();
        },
    };
    return gw;
};

module.exports = { createFakePaygate, PAYGATE_ID, KEY, RECURRING_ID, TEST_VAULT_WIRE, TEST_CHARGE_WIRE, TEST_DELETE_WIRE };
