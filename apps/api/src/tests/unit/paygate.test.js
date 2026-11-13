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

describe('terminals', () => {
    const saved = { ...process.env };
    afterEach(() => { process.env = { ...saved }; });

    it('terminal 1 ("One time and tokenization") is the PAYGATE_* settings, and the default', () => {
        process.env.PAYGATE_ID = '111';
        process.env.PAYGATE_PASSWORD = 'pay';
        delete process.env.PAYGATE_ENCRYPTION_KEY;
        expect(paygate.config()).toEqual(paygate.config('tokenize'));
        expect(paygate.config('tokenize')).toMatchObject({ paygateId: '111', password: 'pay', checksumKey: 'pay' });
        expect(paygate.isConfigured('tokenize')).toBe(true);
    });

    it('terminal 2 ("NON3DS", monthly charges) has its own settings and is never terminal 1', () => {
        process.env.PAYGATE_ID = '111';
        process.env.PAYGATE_PASSWORD = 'pay';
        delete process.env.PAYGATE_RECURRING_ID;
        delete process.env.PAYGATE_RECURRING_PASSWORD;
        expect(paygate.isConfigured('recurring')).toBe(false);
        process.env.PAYGATE_RECURRING_ID = '222';
        process.env.PAYGATE_RECURRING_PASSWORD = 'rec';
        expect(paygate.config('recurring')).toMatchObject({ paygateId: '222', password: 'rec', checksumKey: 'rec' });
        expect(paygate.config('tokenize')).toMatchObject({ paygateId: '111' });
    });

    it('an unknown terminal is an error, never a silent fallback to another one', () => {
        expect(() => paygate.config('non3ds')).toThrow(/Unknown PayGate terminal/);
    });
});

// Answers recorded from PayGate's test gateway (public test account, test card), 2026-11-13.
const REAL = {
    queryWithVault: '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><ns2:SingleFollowUpResponse xmlns:ns2="http://www.paygate.co.za/PayHOST"><ns2:QueryResponse><ns2:Status><ns2:TransactionId>1274098159</ns2:TransactionId><ns2:Reference>BSTEST1794601445185</ns2:Reference><ns2:StatusName>Pending</ns2:StatusName><ns2:AuthCode/><ns2:PayRequestId>0660598E-5DF9-4C0B-A584-E97A3EC3C0D1</ns2:PayRequestId><ns2:VaultId>0a81d7b8-df33-4b2b-b0f0-c24b09ea1865</ns2:VaultId><ns2:PayVaultData><ns2:name>cardNumber</ns2:name><ns2:value>400000xxxxxx0002</ns2:value></ns2:PayVaultData><ns2:PayVaultData><ns2:name>expDate</ns2:name><ns2:value>012030</ns2:value></ns2:PayVaultData><ns2:TransactionStatusCode>0</ns2:TransactionStatusCode><ns2:TransactionStatusDescription>Not Done</ns2:TransactionStatusDescription><ns2:ResultCode>900201</ns2:ResultCode><ns2:ResultDescription>Phase 1 authentication complete</ns2:ResultDescription><ns2:Currency>ZAR</ns2:Currency><ns2:Amount>500</ns2:Amount><ns2:RiskIndicator>NP</ns2:RiskIndicator><ns2:PaymentType><ns2:Method>CC</ns2:Method><ns2:Detail>Visa</ns2:Detail></ns2:PaymentType></ns2:Status></ns2:QueryResponse></ns2:SingleFollowUpResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>',
    chargeRefused3ds: '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><ns2:SinglePaymentResponse xmlns:ns2="http://www.paygate.co.za/PayHOST"><ns2:CardPaymentResponse><ns2:Status><ns2:StatusName>Error</ns2:StatusName><ns2:TransactionStatusCode>0</ns2:TransactionStatusCode><ns2:TransactionStatusDescription>Not Done</ns2:TransactionStatusDescription><ns2:ResultCode>15</ns2:ResultCode><ns2:ResultDescription>Transaction cant be Merchant Initiated with 3D Enabled Terminal</ns2:ResultDescription></ns2:Status></ns2:CardPaymentResponse></ns2:SinglePaymentResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>',
    deleted: '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><ns2:SingleVaultResponse xmlns:ns2="http://www.paygate.co.za/PayHOST"><ns2:DeleteVaultResponse><ns2:Status><ns2:StatusName>Completed</ns2:StatusName></ns2:Status></ns2:DeleteVaultResponse></ns2:SingleVaultResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>',
    validationError: '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><ns2:SinglePaymentResponse xmlns:ns2="http://www.paygate.co.za/PayHOST"><ns2:WebPaymentResponse><ns2:Status><ns2:StatusName>ValidationError</ns2:StatusName><ns2:StatusDetail>Order-&gt;BillingDetails-&gt;Address-&gt;Country is a required field.</ns2:StatusDetail></ns2:Status></ns2:WebPaymentResponse></ns2:SinglePaymentResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>',
};

describe('charging and deleting a saved card (PayHost PayVault)', () => {
    const saved = { ...process.env };
    const sent = [];
    beforeEach(() => {
        process.env.PAYGATE_RECURRING_ID = '222';
        process.env.PAYGATE_RECURRING_PASSWORD = 'rec';
        process.env.PAYGATE_ID = '111';
        process.env.PAYGATE_PASSWORD = 'pay';
        sent.length = 0;
    });
    afterEach(() => {
        process.env = { ...saved };
        for (const w of ['vault', 'charge', 'deleteVault']) paygate.setWire(w, null);
        paygate.setTransport();
    });
    const answer = (body) => async ({ soapAction, body: b }) => { sent.push({ soapAction, body: b }); return { status: 200, body }; };
    const charged = (code) => `<Envelope><Body><SinglePaymentResponse><CardPaymentResponse><Status><StatusName>Completed</StatusName><PayRequestId>PR1</PayRequestId><Reference>BSX</Reference><TransactionStatusCode>${code}</TransactionStatusCode><Amount>6999</Amount><Currency>NAD</Currency></Status></CardPaymentResponse></SinglePaymentResponse></Body></Envelope>`;

    it('PayHost\'s formats are in place; a format marked not ready stops everything, sending nothing', async () => {
        expect(paygate.recurringReady()).toBe(true);
        paygate.setWire('charge', false);
        expect(paygate.recurringReady()).toBe(false);
        paygate.setTransport(answer(''));
        await expect(paygate.chargeVault({ vaultId: 'abcdef1234', reference: 'BSX', amountCents: 100 })).rejects.toMatchObject({ code: 'VAULT_NOT_READY' });
        paygate.setWire('deleteVault', false);
        await expect(paygate.deleteVault({ vaultId: 'abcdef1234' })).rejects.toMatchObject({ code: 'VAULT_NOT_READY' });
        expect(sent).toHaveLength(0);
        paygate.setWire('charge', null);
        paygate.setWire('deleteVault', null);
        expect(paygate.recurringReady()).toBe(true);
        expect(() => paygate.setWire('other', {})).toThrow(/Unknown wire/);
    });

    it('charges on terminal 2: a merchant-initiated recurring CardPaymentRequest with the token, no CVV', async () => {
        paygate.setTransport(answer(charged(1)));
        const r = await paygate.chargeVault({
            vaultId: 'eb9c11c5-e564-46e2-a087-2207ab8afadd', reference: 'BS<X>', amountCents: 6999,
            customer: { firstName: 'Ana', lastName: 'Shikongo', email: 'a@x.na' }, notifyUrl: 'https://api/n', returnUrl: 'https://api/r',
        });
        expect(r).toMatchObject({ ok: true, transactionStatusCode: 1, payRequestId: 'PR1', amountCents: 6999 });
        const b = sent[0].body;
        expect(b).toMatch(/<SinglePaymentRequest xmlns="http:\/\/www\.paygate\.co\.za\/PayHOST"><CardPaymentRequest><Account><PayGateId>222<\/PayGateId><Password>rec<\/Password><\/Account><Customer><FirstName>Ana<\/FirstName><LastName>Shikongo<\/LastName><Email>a@x\.na<\/Email><\/Customer><VaultId>eb9c11c5-e564-46e2-a087-2207ab8afadd<\/VaultId><BudgetPeriod>0<\/BudgetPeriod><Redirect>/);
        expect(b).toContain('<MerchantOrderId>BS&lt;X&gt;</MerchantOrderId><Currency>NAD</Currency><Amount>6999</Amount>');
        expect(b).toContain('</Order><Recurring><RecurringTransactionType>RECURRING</RecurringTransactionType><InitiatedType>MERCHANT</InitiatedType></Recurring></CardPaymentRequest>');
        expect(b).not.toContain('<CVV>');
    });

    it('refuses without a token-shaped vault id, a positive amount, or terminal 2 settings', async () => {
        paygate.setTransport(answer(''));
        await expect(paygate.chargeVault({ vaultId: '<x>', reference: 'BSX', amountCents: 100 })).rejects.toMatchObject({ code: 'NO_VAULT' });
        await expect(paygate.chargeVault({ vaultId: 'abcdef1234', reference: 'BSX', amountCents: 0 })).rejects.toMatchObject({ code: 'BAD_AMOUNT' });
        delete process.env.PAYGATE_RECURRING_ID;
        await expect(paygate.chargeVault({ vaultId: 'abcdef1234', reference: 'BSX', amountCents: 100 })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
        expect(sent).toHaveLength(0);
    });

    it('PayGate refusing a charge (Error, code 0) is a clean failure, never an open payment', () => {
        expect(paygate.parseChargeResponse(REAL.chargeRefused3ds))
            .toMatchObject({ ok: false, error: { code: 'GATEWAY_ERROR', message: 'Transaction cant be Merchant Initiated with 3D Enabled Terminal', resultCode: '15' } });
        expect(paygate.parseChargeResponse('<Envelope><Body><Fault><faultcode>x</faultcode><faultstring>no</faultstring></Fault></Body></Envelope>')).toMatchObject({ ok: false, error: { code: 'SOAP_FAULT' } });
        expect(paygate.parseChargeResponse('not xml <<<')).toMatchObject({ ok: false });
        // 3D Secure asked for: nobody is there, nothing is charged.
        expect(paygate.parseChargeResponse('<Envelope><Body><SinglePaymentResponse><CardPaymentResponse><Status><StatusName>ThreeDSecureRedirectRequired</StatusName><TransactionStatusCode>0</TransactionStatusCode></Status><Redirect><RedirectUrl>https://x</RedirectUrl></Redirect></CardPaymentResponse></SinglePaymentResponse></Body></Envelope>'))
            .toMatchObject({ ok: false, error: { code: 'NEEDS_3DS' } });
        expect(paygate.parseChargeResponse(charged(2))).toMatchObject({ ok: true, transactionStatusCode: 2 });
    });

    it('deletes a saved card on terminal 1 with a DeleteVaultRequest; an Error or ValidationError is a failure', async () => {
        paygate.setTransport(answer(REAL.deleted));
        expect(await paygate.deleteVault({ vaultId: 'abcdef1234' })).toEqual({ ok: true });
        expect(sent[0].body).toContain('<SingleVaultRequest xmlns="http://www.paygate.co.za/PayHOST"><DeleteVaultRequest><Account><PayGateId>111</PayGateId><Password>pay</Password></Account><VaultId>abcdef1234</VaultId></DeleteVaultRequest></SingleVaultRequest>');
        expect(paygate.parseDeleteVaultResponse('<Envelope><Body><DeleteVaultResponse><Status><StatusName>Error</StatusName></Status></DeleteVaultResponse></Body></Envelope>')).toMatchObject({ ok: false });
        expect(paygate.parseDeleteVaultResponse(REAL.validationError)).toMatchObject({ ok: false });
    });
});

describe('vault (saving the card)', () => {
    const base = {
        paygateId: '1', password: 'p', reference: 'BSX', amountCents: 6999, currency: 'NAD', customer: {}, notifyUrl: 'n', returnUrl: 'r',
    };
    afterEach(() => paygate.setVaultWire(null));

    it('asks PayHost to save the card (<Vault> after <Customer>) and starts a recurring agreement after <Order>, only when asked', () => {
        const xml = paygate.buildWebPaymentRequest({ ...base, vault: true });
        expect(xml).toMatch(/<\/Customer><Vault>true<\/Vault><Redirect>/);
        expect(xml).toContain('</Order><Recurring><InitialAuth>true</InitialAuth><RecurringTransactionType>RECURRING</RecurringTransactionType><InitiatedType>CARD_HOLDER</InitiatedType></Recurring></WebPaymentRequest>');
        const plain = paygate.buildWebPaymentRequest(base);
        expect(plain).not.toContain('<Vault>');
        expect(plain).not.toContain('<Recurring>');
    });

    it('marked not ready: a request to save a card is refused; an ordinary payment is unaffected', () => {
        paygate.setVaultWire(false);
        expect(paygate.vaultReady()).toBe(false);
        expect(() => paygate.buildWebPaymentRequest({ ...base, vault: true })).toThrow(expect.objectContaining({ code: 'VAULT_NOT_READY' }));
        expect(paygate.buildWebPaymentRequest(base)).toContain('<Amount>6999</Amount>');
    });

    it('reads the saved card from a real Query answer: token, masked number, expiry, brand', () => {
        const q = paygate.parseQueryResponse(REAL.queryWithVault);
        expect(q).toMatchObject({ ok: true, transactionStatusCode: 0 });
        expect(q.vault).toEqual({ vaultId: '0a81d7b8-df33-4b2b-b0f0-c24b09ea1865', brand: 'Visa', maskedCard: '400000xxxxxx0002', expiry: '012030' });
        expect(paygate.cardSummary(q.vault)).toEqual({ vaultId: '0a81d7b8-df33-4b2b-b0f0-c24b09ea1865', brand: 'Visa', last4: '0002', expMonth: 1, expYear: 2030 });
        // No VaultId: no card. A broken extractor never breaks the Query.
        expect(paygate.parseQueryResponse(REAL.queryWithVault.replace(/<ns2:VaultId>[^<]*<\/ns2:VaultId>/, '')).vault).toBeNull();
        paygate.setVaultWire({ after: 'Customer', requestXml: '<X/>', extract: () => { throw new Error('boom'); } });
        expect(paygate.parseQueryResponse(REAL.queryWithVault)).toMatchObject({ ok: true, vault: null });
        paygate.setVaultWire(false);
        expect(paygate.parseQueryResponse(REAL.queryWithVault).vault).toBeNull();
    });

    it('a ValidationError from PayHost is a failed session, not a payment', () => {
        expect(paygate.parseWebPaymentResponse(REAL.validationError)).toMatchObject({ ok: false, error: { code: 'GATEWAY_ERROR' } });
    });

    it('cardSummary keeps the token, brand, last 4 and expiry only', () => {
        expect(paygate.cardSummary({ vaultId: 'a1b2c3d4-e5f6', brand: 'Visa', maskedCard: '400000xxxxxx0002', expiry: '122030' }))
            .toEqual({ vaultId: 'a1b2c3d4-e5f6', brand: 'Visa', last4: '0002', expMonth: 12, expYear: 2030 });
        expect(paygate.cardSummary({ vaultId: 'a1b2c3d4-e5f6', maskedCard: '****1111', expiry: '07/29' }))
            .toEqual({ vaultId: 'a1b2c3d4-e5f6', brand: null, last4: '1111', expMonth: 7, expYear: 2029 });
        // A full card number never survives: only its last 4 digits.
        const s = paygate.cardSummary({ vaultId: 'a1b2c3d4-e5f6', maskedCard: '4000000000000002', expiry: '1330' });
        expect(JSON.stringify(s)).not.toContain('400000');
        expect(s).toMatchObject({ last4: '0002', expMonth: null, expYear: null });
        // No token (or not token-shaped): nothing.
        expect(paygate.cardSummary({ maskedCard: '****1111' })).toBeNull();
        expect(paygate.cardSummary({ vaultId: '<script>' })).toBeNull();
        expect(paygate.cardSummary(null)).toBeNull();
    });
});
