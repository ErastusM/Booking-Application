/**
 * PayGate PayHost wire format: request builders and response parsers against
 * literal XML, checksum verification, and the transport seam.
 */
const crypto = require('crypto');
const paygate = require('../../services/paygate');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

describe('request builders', () => {
    it('WebPaymentRequest carries the account, customer, redirects and the order in cents, XML-escaped', () => {
        const xml = paygate.buildWebPaymentRequest({
            paygateId: '10011072130', password: 'test', reference: 'BPABC', amountCents: 12550, currency: 'NAD',
            customer: { firstName: 'Ana & <Co>', lastName: "O'Neil", email: 'ana@example.com' },
            notifyUrl: 'https://api.example.com/api/payments/paygate/notify',
            returnUrl: 'https://api.example.com/api/payments/paygate/return',
        });
        expect(xml).toContain('<SinglePaymentRequest xmlns="http://www.paygate.co.za/PayHOST"><WebPaymentRequest>');
        expect(xml).toContain('<Account><PayGateId>10011072130</PayGateId><Password>test</Password></Account>');
        expect(xml).toContain('<FirstName>Ana &amp; &lt;Co&gt;</FirstName><LastName>O&apos;Neil</LastName>');
        expect(xml).toContain('<NotifyUrl>https://api.example.com/api/payments/paygate/notify</NotifyUrl>');
        expect(xml).toContain('<MerchantOrderId>BPABC</MerchantOrderId><Currency>NAD</Currency><Amount>12550</Amount>');
        expect(xml).toContain('<BillingDetails><Customer>');
        expect(xml).toContain('<Address><Country>NAM</Country></Address>');
        expect(xml).toContain('<Locale>en</Locale>');
        expect(xml).not.toMatch(/Ana & </);
    });

    it('refuses an amount that is not a positive whole number of cents', () => {
        const base = { paygateId: '1', password: 'p', reference: 'R', currency: 'NAD', customer: {}, notifyUrl: 'n', returnUrl: 'r' };
        expect(() => paygate.buildWebPaymentRequest({ ...base, amountCents: 12.5 })).toThrow(/cents/);
        expect(() => paygate.buildWebPaymentRequest({ ...base, amountCents: 0 })).toThrow(/cents/);
        expect(() => paygate.buildRefundRequest({ paygateId: '1', password: 'p', transactionId: 'T', amountCents: -1 })).toThrow(/cents/);
    });

    it('Query and Refund requests are SingleFollowUpRequests', () => {
        const q = paygate.buildQueryRequest({ paygateId: '1', password: 'p', payRequestId: 'PR-1' });
        expect(q).toContain('<SingleFollowUpRequest xmlns="http://www.paygate.co.za/PayHOST"><QueryRequest>');
        expect(q).toContain('<PayRequestId>PR-1</PayRequestId>');
        const r = paygate.buildRefundRequest({ paygateId: '1', password: 'p', transactionId: '777', amountCents: 500 });
        expect(r).toContain('<RefundRequest><Account>');
        expect(r).toContain('<TransactionId>777</TransactionId><Amount>500</Amount>');
    });
});

const WEB_OK = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns2="http://www.paygate.co.za/PayHOST">
  <SOAP-ENV:Body>
    <ns2:SinglePaymentResponse>
      <ns2:WebPaymentResponse>
        <ns2:Redirect>
          <ns2:RedirectUrl>https://secure.paygate.co.za/payweb3/process.trans</ns2:RedirectUrl>
          <ns2:UrlParams><ns2:key>PAYGATE_ID</ns2:key><ns2:value>10011072130</ns2:value></ns2:UrlParams>
          <ns2:UrlParams><ns2:key>PAY_REQUEST_ID</ns2:key><ns2:value>23B785AE-C96C-32AF-4879-D2C9363DB6E8</ns2:value></ns2:UrlParams>
          <ns2:UrlParams><ns2:key>REFERENCE</ns2:key><ns2:value>BPABC</ns2:value></ns2:UrlParams>
          <ns2:UrlParams><ns2:key>CHECKSUM</ns2:key><ns2:value>b41a77f83a275a849f23e30b4666e837</ns2:value></ns2:UrlParams>
        </ns2:Redirect>
        <ns2:Status><ns2:StatusName>Completed</ns2:StatusName></ns2:Status>
      </ns2:WebPaymentResponse>
    </ns2:SinglePaymentResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

const WEB_ERROR = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns2="http://www.paygate.co.za/PayHOST">
  <SOAP-ENV:Body><ns2:SinglePaymentResponse><ns2:WebPaymentResponse>
    <ns2:Status><ns2:StatusName>Error</ns2:StatusName><ns2:ResultCode>900026</ns2:ResultCode><ns2:ResultDescription>Invalid currency</ns2:ResultDescription></ns2:Status>
  </ns2:WebPaymentResponse></ns2:SinglePaymentResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const FAULT = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring>Validation error</faultstring>
  <detail><payhost:error xmlns:payhost="http://www.paygate.co.za/PayHOST">cvc-complex-type.2.4.a</payhost:error></detail>
  </SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const queryXml = ({ code = 1, desc = 'Approved', amount = '12550', currency = 'NAD', reference = 'BPABC', statusName = 'Completed' } = {}) => `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns2="http://www.paygate.co.za/PayHOST">
  <SOAP-ENV:Body><ns2:SingleFollowUpResponse><ns2:QueryResponse><ns2:Status>
    <ns2:TransactionId>18693753</ns2:TransactionId>
    <ns2:Reference>${reference}</ns2:Reference>
    <ns2:AcquirerCode>00</ns2:AcquirerCode>
    <ns2:StatusName>${statusName}</ns2:StatusName>
    <ns2:AuthCode>2BCRAD</ns2:AuthCode>
    <ns2:PayRequestId>23B785AE-C96C-32AF-4879-D2C9363DB6E8</ns2:PayRequestId>
    <ns2:TransactionStatusCode>${code}</ns2:TransactionStatusCode>
    <ns2:TransactionStatusDescription>${desc}</ns2:TransactionStatusDescription>
    <ns2:ResultCode>990017</ns2:ResultCode>
    <ns2:ResultDescription>Auth Done</ns2:ResultDescription>
    <ns2:Currency>${currency}</ns2:Currency>
    <ns2:Amount>${amount}</ns2:Amount>
    <ns2:RiskIndicator>AX</ns2:RiskIndicator>
    <ns2:PaymentType><ns2:Method>CC</ns2:Method><ns2:Detail>Visa</ns2:Detail></ns2:PaymentType>
  </ns2:Status></ns2:QueryResponse></ns2:SingleFollowUpResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const REFUND_OK = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns2="http://www.paygate.co.za/PayHOST">
  <SOAP-ENV:Body><ns2:SingleFollowUpResponse><ns2:RefundResponse><ns2:Status>
    <ns2:TransactionId>18693999</ns2:TransactionId><ns2:StatusName>Completed</ns2:StatusName>
    <ns2:TransactionStatusCode>1</ns2:TransactionStatusCode><ns2:TransactionStatusDescription>Approved</ns2:TransactionStatusDescription>
    <ns2:ResultCode>990017</ns2:ResultCode><ns2:ResultDescription>Auth Done</ns2:ResultDescription>
    <ns2:Currency>NAD</ns2:Currency><ns2:Amount>500</ns2:Amount>
  </ns2:Status></ns2:RefundResponse></ns2:SingleFollowUpResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const REFUND_DECLINED = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns2="http://www.paygate.co.za/PayHOST">
  <SOAP-ENV:Body><ns2:SingleFollowUpResponse><ns2:RefundResponse><ns2:Status>
    <ns2:StatusName>Error</ns2:StatusName><ns2:ResultCode>900209</ns2:ResultCode><ns2:ResultDescription>Refund amount exceeds original</ns2:ResultDescription>
  </ns2:Status></ns2:RefundResponse></ns2:SingleFollowUpResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

describe('response parsers', () => {
    it('reads a payment session: redirect URL and every UrlParam', () => {
        const r = paygate.parseWebPaymentResponse(WEB_OK);
        expect(r.ok).toBe(true);
        expect(r.redirectUrl).toBe('https://secure.paygate.co.za/payweb3/process.trans');
        expect(r.payRequestId).toBe('23B785AE-C96C-32AF-4879-D2C9363DB6E8');
        expect(r.fields).toEqual({
            PAYGATE_ID: '10011072130',
            PAY_REQUEST_ID: '23B785AE-C96C-32AF-4879-D2C9363DB6E8',
            REFERENCE: 'BPABC',
            CHECKSUM: 'b41a77f83a275a849f23e30b4666e837',
        });
    });

    it('an error status is a clean failure with PayGate’s result code', () => {
        const r = paygate.parseWebPaymentResponse(WEB_ERROR);
        expect(r.ok).toBe(false);
        expect(r.error).toMatchObject({ code: 'GATEWAY_ERROR', resultCode: '900026', message: 'Invalid currency' });
    });

    it('a SOAP Fault is a clean failure for every response type', () => {
        for (const parse of [paygate.parseWebPaymentResponse, paygate.parseQueryResponse, paygate.parseRefundResponse]) {
            const r = parse(FAULT);
            expect(r.ok).toBe(false);
            expect(r.error.code).toBe('SOAP_FAULT');
            expect(r.error.message).toBe('Validation error');
        }
    });

    it('garbage is a clean failure, not a crash', () => {
        expect(paygate.parseQueryResponse('').ok).toBe(false);
        expect(() => paygate.parseWebPaymentResponse('<<<not xml')).not.toThrow();
        expect(paygate.parseWebPaymentResponse('<<<not xml').ok).toBe(false);
    });

    it('reads an approved query: status code, amount in cents, currency, reference, ids', () => {
        const r = paygate.parseQueryResponse(queryXml());
        expect(r).toMatchObject({
            ok: true, transactionStatusCode: 1, amountCents: 12550, currency: 'NAD', reference: 'BPABC',
            transactionId: '18693753', payRequestId: '23B785AE-C96C-32AF-4879-D2C9363DB6E8',
            resultCode: '990017', authCode: '2BCRAD', payMethod: 'CC', payMethodDetail: 'Visa',
        });
    });

    it('reads a declined query', () => {
        const r = paygate.parseQueryResponse(queryXml({ code: 2, desc: 'Declined' }));
        expect(r.ok).toBe(true);
        expect(r.transactionStatusCode).toBe(paygate.TX.DECLINED);
        expect(r.transactionStatusDescription).toBe('Declined');
    });

    it('reads a refund: approved vs declined', () => {
        const ok = paygate.parseRefundResponse(REFUND_OK);
        expect(ok).toMatchObject({ ok: true, transactionId: '18693999', amountCents: 500 });
        const no = paygate.parseRefundResponse(REFUND_DECLINED);
        expect(no.ok).toBe(false);
        expect(no.error).toMatchObject({ code: 'REFUND_DECLINED', resultCode: '900209' });
    });
});

describe('checksums', () => {
    it('verifies a notify over the posted values in order, extra fields included', () => {
        const key = 'secret';
        const fields = [
            ['PAYGATE_ID', '10011072130'], ['PAY_REQUEST_ID', 'PR'], ['REFERENCE', 'BPABC'], ['TRANSACTION_STATUS', '1'],
            ['RESULT_CODE', '990017'], ['AUTH_CODE', 'X'], ['CURRENCY', 'NAD'], ['AMOUNT', '12550'], ['VAULT_ID', 'v-1'],
        ];
        const checksum = md5(fields.map(([, v]) => v).join('') + key);
        expect(paygate.verifyPostedChecksum([...fields, ['CHECKSUM', checksum]], key)).toBe(true);
        expect(paygate.verifyPostedChecksum([...fields, ['CHECKSUM', checksum.toUpperCase()]], key)).toBe(true);
        // A changed value, a different order, the wrong key, or no checksum all fail.
        const tampered = fields.map(([k, v]) => [k, k === 'AMOUNT' ? '1' : v]);
        expect(paygate.verifyPostedChecksum([...tampered, ['CHECKSUM', checksum]], key)).toBe(false);
        expect(paygate.verifyPostedChecksum([...[...fields].reverse(), ['CHECKSUM', checksum]], key)).toBe(false);
        expect(paygate.verifyPostedChecksum([...fields, ['CHECKSUM', checksum]], 'other')).toBe(false);
        expect(paygate.verifyPostedChecksum(fields, key)).toBe(false);
        expect(paygate.verifyPostedChecksum([...fields, ['CHECKSUM', 'short']], key)).toBe(false);
    });

    it('verifies the PayWeb3 return checksum from our own id and reference', () => {
        const checksum = md5('10011072130PR1BPABCsecret');
        expect(paygate.verifyReturnChecksum({ paygateId: '10011072130', payRequestId: 'PR', transactionStatus: '1', reference: 'BPABC', checksum }, 'secret')).toBe(true);
        expect(paygate.verifyReturnChecksum({ paygateId: '10011072130', payRequestId: 'PR', transactionStatus: '2', reference: 'BPABC', checksum }, 'secret')).toBe(false);
    });
});

describe('transport', () => {
    const prev = { id: process.env.PAYGATE_ID, pw: process.env.PAYGATE_PASSWORD };
    beforeAll(() => { process.env.PAYGATE_ID = '10011072130'; process.env.PAYGATE_PASSWORD = 'secret'; });
    afterAll(() => {
        paygate.setTransport();
        process.env.PAYGATE_ID = prev.id; process.env.PAYGATE_PASSWORD = prev.pw;
        if (prev.id === undefined) delete process.env.PAYGATE_ID;
        if (prev.pw === undefined) delete process.env.PAYGATE_PASSWORD;
    });

    it('sends SOAP with the right action to the endpoint and parses the answer', async () => {
        const calls = [];
        paygate.setTransport(async (req) => { calls.push(req); return { status: 200, body: queryXml() }; });
        const r = await paygate.query({ payRequestId: 'PR' });
        expect(r.ok).toBe(true);
        expect(calls[0].soapAction).toBe('SingleFollowUpRequest');
        expect(calls[0].endpoint).toBe(paygate.DEFAULT_ENDPOINT);
        expect(calls[0].body).toContain('<PayRequestId>PR</PayRequestId>');
    });

    it('a network failure is a PaygateError that never echoes the password', async () => {
        paygate.setTransport(async () => { throw new Error('ECONNRESET'); });
        await expect(paygate.initiate({ reference: 'R', amountCents: 100, currency: 'NAD', customer: {}, notifyUrl: 'n', returnUrl: 'r' }))
            .rejects.toMatchObject({ name: 'PaygateError', code: 'NETWORK' });
        try { await paygate.refund({ transactionId: 'T', amountCents: 100 }); } catch (e) { expect(e.message).not.toContain('secret'); }
    });

    it('refuses to call PayGate without credentials', async () => {
        delete process.env.PAYGATE_PASSWORD;
        await expect(paygate.query({ payRequestId: 'PR' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
        process.env.PAYGATE_PASSWORD = 'secret';
    });
});

// Responses captured from PayGate's public TEST merchant (10011072130) on
// 6 Oct 2026, exactly as sent (namespace prefix ns2, NAD). They pin the parser
// to the real wire format rather than to our reading of it.
describe('real PayGate responses (test merchant)', () => {
    const wrap = (body) => `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header/><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    const statusXml = (inner) => wrap(`<ns2:SingleFollowUpResponse xmlns:ns2="http://www.paygate.co.za/PayHOST"><ns2:QueryResponse><ns2:Status>${inner}</ns2:Status></ns2:QueryResponse></ns2:SingleFollowUpResponse>`);

    it('a new session: WebRedirectRequired with the PayHost redirect and its four params', () => {
        const xml = wrap('<ns2:SinglePaymentResponse xmlns:ns2="http://www.paygate.co.za/PayHOST"><ns2:WebPaymentResponse><ns2:Status><ns2:StatusName>WebRedirectRequired</ns2:StatusName><ns2:StatusDetail>Web Redirect Required To Complete Transaction</ns2:StatusDetail></ns2:Status><ns2:Redirect><ns2:RedirectUrl>https://secure.paygate.co.za/PayHost/process.trans</ns2:RedirectUrl><ns2:UrlParams><ns2:key>PAYGATE_ID</ns2:key><ns2:value>10011072130</ns2:value></ns2:UrlParams><ns2:UrlParams><ns2:key>PAY_REQUEST_ID</ns2:key><ns2:value>8B05205D-B156-4030-9615-55FE7DE06F02</ns2:value></ns2:UrlParams><ns2:UrlParams><ns2:key>REFERENCE</ns2:key><ns2:value>BP72ff5915baafb84cf8f48652fff535</ns2:value></ns2:UrlParams><ns2:UrlParams><ns2:key>CHECKSUM</ns2:key><ns2:value>f26e9dc9ca34ebd3f52cd2896a955e73</ns2:value></ns2:UrlParams></ns2:Redirect></ns2:WebPaymentResponse></ns2:SinglePaymentResponse>');
        const r = paygate.parseWebPaymentResponse(xml);
        expect(r.ok).toBe(true);
        expect(r.redirectUrl).toBe('https://secure.paygate.co.za/PayHost/process.trans');
        expect(r.payRequestId).toBe('8B05205D-B156-4030-9615-55FE7DE06F02');
        expect(Object.keys(r.fields)).toEqual(['PAYGATE_ID', 'PAY_REQUEST_ID', 'REFERENCE', 'CHECKSUM']);
    });

    it('a query for a session nobody paid yet: code 0, PayGate result 401 — not paid', () => {
        const q = paygate.parseQueryResponse(statusXml('<ns2:StatusName>Error</ns2:StatusName><ns2:TransactionStatusCode>0</ns2:TransactionStatusCode><ns2:TransactionStatusDescription>Not Done</ns2:TransactionStatusDescription><ns2:ResultCode>401</ns2:ResultCode><ns2:ResultDescription>Requested Transaction Does Not Exist</ns2:ResultDescription>'));
        expect(q.transactionStatusCode).toBe(paygate.TX.NOT_DONE);
        expect(q.transactionStatusCode).not.toBe(paygate.TX.APPROVED);
    });

    it('StatusName "Completed" with code 0 (card authentication failed) is NOT a payment', () => {
        const q = paygate.parseQueryResponse(statusXml('<ns2:TransactionId>1256255355</ns2:TransactionId><ns2:Reference>BPef69381dafc7112ce14e843be83cb6</ns2:Reference><ns2:StatusName>Completed</ns2:StatusName><ns2:AuthCode/><ns2:PayRequestId>CC188936-172F-4DD9-93C8-A3DC1F560026</ns2:PayRequestId><ns2:TransactionStatusCode>0</ns2:TransactionStatusCode><ns2:TransactionStatusDescription>Not Done</ns2:TransactionStatusDescription><ns2:ResultCode>900205</ns2:ResultCode><ns2:ResultDescription>Unexpected authentication result (phase 1)</ns2:ResultDescription><ns2:Currency>NAD</ns2:Currency><ns2:Amount>12345</ns2:Amount><ns2:RiskIndicator>XP</ns2:RiskIndicator><ns2:PaymentType><ns2:Method>CC</ns2:Method><ns2:Detail>Visa</ns2:Detail></ns2:PaymentType><ns2:DateTime>2026-10-06T14:39:30.000+02:00</ns2:DateTime><ns2:TransactionType>Authorisation</ns2:TransactionType>'));
        expect(q.statusName).toBe('Completed');
        expect(q.transactionStatusCode).toBe(0);
        expect(q).toMatchObject({ amountCents: 12345, currency: 'NAD', reference: 'BPef69381dafc7112ce14e843be83cb6', transactionId: '1256255355', payMethod: 'CC' });
    });

    it('a declined card: code 2 with the bank reason', () => {
        const q = paygate.parseQueryResponse(statusXml('<ns2:TransactionId>1256256296</ns2:TransactionId><ns2:Reference>BP2411bae205b8c67aa7c7cb0444c30f</ns2:Reference><ns2:AcquirerCode>05</ns2:AcquirerCode><ns2:StatusName>Completed</ns2:StatusName><ns2:AuthCode/><ns2:PayRequestId>C8DFE002-A41C-40F8-B911-B81351DD7EF4</ns2:PayRequestId><ns2:TransactionStatusCode>2</ns2:TransactionStatusCode><ns2:TransactionStatusDescription>Declined</ns2:TransactionStatusDescription><ns2:ResultCode>900014</ns2:ResultCode><ns2:ResultDescription>Excessive Card Usage</ns2:ResultDescription><ns2:Currency>NAD</ns2:Currency><ns2:Amount>12345</ns2:Amount>'));
        expect(q.transactionStatusCode).toBe(paygate.TX.DECLINED);
        expect(q.resultDescription).toBe('Excessive Card Usage');
    });

    it('a refund PayGate refuses is a clean failure', () => {
        const r = paygate.parseRefundResponse(wrap('<ns2:SingleFollowUpResponse xmlns:ns2="http://www.paygate.co.za/PayHOST"><ns2:RefundResponse><ns2:Status><ns2:StatusName>Error</ns2:StatusName><ns2:TransactionStatusCode>0</ns2:TransactionStatusCode><ns2:TransactionStatusDescription>Not Done</ns2:TransactionStatusDescription><ns2:ResultCode>201</ns2:ResultCode><ns2:ResultDescription>Unable To Find Original Transaction</ns2:ResultDescription></ns2:Status></ns2:RefundResponse></ns2:SingleFollowUpResponse>'));
        expect(r.ok).toBe(false);
        expect(r.error).toMatchObject({ resultCode: '201' });
    });

    it('the browser return post verifies with md5(id + request id + status + reference + key)', () => {
        // Captured return: PAY_REQUEST_ID=CC188936-…, TRANSACTION_STATUS=0; key "test".
        expect(paygate.verifyReturnChecksum({
            paygateId: '10011072130', payRequestId: 'CC188936-172F-4DD9-93C8-A3DC1F560026', transactionStatus: '0',
            reference: 'BPef69381dafc7112ce14e843be83cb6', checksum: '8003c1732e24e0445298467a01617a9a',
        }, 'test')).toBe(true);
    });
});
