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
            paygate.setTransport(gw.transport);
        },
        uninstall() { paygate.setTransport(); },
        reset() { gw.tx.clear(); gw.calls.length = 0; gw.initFail = false; gw.refundFail = false; },
        async transport({ soapAction, body }) {
            gw.calls.push({ soapAction, body });
            if (body.includes('<WebPaymentRequest>')) {
                if (gw.initFail) {
                    return { status: 500, body: soap('<SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring>Service unavailable</faultstring></SOAP-ENV:Fault>') };
                }
                n += 1;
                const payRequestId = `PR-${String(n).padStart(4, '0')}-${crypto.randomBytes(4).toString('hex')}`;
                const reference = tag(body, 'MerchantOrderId');
                gw.tx.set(payRequestId, {
                    reference, amountCents: Number(tag(body, 'Amount')), currency: tag(body, 'Currency'), code: 0, transactionId: String(18690000 + n),
                });
                const params = [['PAYGATE_ID', PAYGATE_ID], ['PAY_REQUEST_ID', payRequestId], ['REFERENCE', reference]];
                params.push(['CHECKSUM', md5(params.map(([, v]) => v).join('') + KEY)]);
                return {
                    status: 200,
                    body: soap(`<ns2:SinglePaymentResponse><ns2:WebPaymentResponse><ns2:Redirect><ns2:RedirectUrl>https://secure.paygate.co.za/payweb3/process.trans</ns2:RedirectUrl>${params.map(([k, v]) => `<ns2:UrlParams><ns2:key>${k}</ns2:key><ns2:value>${v}</ns2:value></ns2:UrlParams>`).join('')}</ns2:Redirect><ns2:Status><ns2:StatusName>Completed</ns2:StatusName></ns2:Status></ns2:WebPaymentResponse></ns2:SinglePaymentResponse>`),
                };
            }
            if (body.includes('<QueryRequest>')) {
                const id = tag(body, 'PayRequestId');
                const t = gw.tx.get(id);
                if (!t) return { status: 200, body: soap('<ns2:SingleFollowUpResponse><ns2:QueryResponse><ns2:Status><ns2:StatusName>Error</ns2:StatusName><ns2:ResultCode>900001</ns2:ResultCode></ns2:Status></ns2:QueryResponse></ns2:SingleFollowUpResponse>') };
                return {
                    status: 200,
                    body: soap(`<ns2:SingleFollowUpResponse><ns2:QueryResponse><ns2:Status><ns2:TransactionId>${t.transactionId}</ns2:TransactionId><ns2:Reference>${t.referenceOverride || t.reference}</ns2:Reference><ns2:StatusName>Completed</ns2:StatusName><ns2:PayRequestId>${id}</ns2:PayRequestId><ns2:TransactionStatusCode>${t.code}</ns2:TransactionStatusCode><ns2:TransactionStatusDescription>${['Not Done', 'Approved', 'Declined', 'Cancelled', 'User Cancelled', 'Received by PayGate'][t.code] || 'Unknown'}</ns2:TransactionStatusDescription><ns2:ResultCode>${t.code === 1 ? '990017' : '900003'}</ns2:ResultCode><ns2:ResultDescription>${t.code === 1 ? 'Auth Done' : 'Insufficient Funds'}</ns2:ResultDescription><ns2:Currency>${t.currencyOverride || t.currency}</ns2:Currency><ns2:Amount>${t.amountOverride ?? t.amountCents}</ns2:Amount><ns2:PaymentType><ns2:Method>CC</ns2:Method><ns2:Detail>Visa</ns2:Detail></ns2:PaymentType></ns2:Status></ns2:QueryResponse></ns2:SingleFollowUpResponse>`),
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
        notifyBody(reference, { status, checksumKey = KEY, tamper } = {}) {
            const hit = gw.byReference(reference);
            const fields = [
                ['PAYGATE_ID', PAYGATE_ID], ['PAY_REQUEST_ID', hit.payRequestId], ['REFERENCE', reference],
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
        returnBody(reference, { status } = {}) {
            const hit = gw.byReference(reference);
            const st = String(status ?? hit.code);
            const checksum = md5(`${PAYGATE_ID}${hit.payRequestId}${st}${reference}${KEY}`);
            return new URLSearchParams([['PAY_REQUEST_ID', hit.payRequestId], ['TRANSACTION_STATUS', st], ['CHECKSUM', checksum]]).toString();
        },
    };
    return gw;
};

module.exports = { createFakePaygate, PAYGATE_ID, KEY };
