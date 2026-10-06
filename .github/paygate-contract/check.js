// Temporary contract check against PayGate's PUBLIC test merchant
// (10011072130 / "test", from PayGate's own docs and our Postman collection).
// Prints raw XML responses (test account, no secrets) and what our parser
// made of them, so every assumption in services/paygate.js can be checked.
process.env.PAYGATE_ID = '10011072130';
process.env.PAYGATE_PASSWORD = 'test';
const pg = require('../../apps/api/src/services/paygate');
const https = require('https');

let lastRaw = '';
const real = (args) => new Promise((resolve, reject) => {
  const u = new URL(args.endpoint);
  const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: args.soapAction, 'Content-Length': Buffer.byteLength(args.body) } }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { lastRaw = d; resolve({ status: res.statusCode, body: d }); });
  });
  req.on('error', reject); req.write(args.body); req.end();
});

(async () => {
  // Wrap the module's real transport so we see the raw XML.
  pg.setTransport(async (a) => { const r = await real(a); return r.body !== undefined ? r.body : r; });
  for (const currency of ['NAD', 'ZAR']) {
    const reference = 'BP' + require('crypto').randomBytes(15).toString('hex');
    console.log(`\n================ INITIATE ${currency} ${reference}`);
    let init;
    try {
      init = await pg.initiate({ reference, amountCents: 100, currency,
        customer: { firstName: 'Test', lastName: 'Client', email: 'test@example.com' },
        notifyUrl: 'https://example.com/notify', returnUrl: 'https://example.com/return' });
    } catch (e) { console.log('initiate threw:', e.message); console.log(lastRaw); continue; }
    console.log('RAW:', lastRaw);
    console.log('PARSED:', JSON.stringify(init, null, 1));
    const payRequestId = init && (init.payRequestId || (init.fields && init.fields.PAY_REQUEST_ID));
    if (!payRequestId) continue;
    console.log(`\n================ QUERY ${currency}`);
    try {
      const q = await pg.query({ payRequestId });
      console.log('RAW:', lastRaw);
      console.log('PARSED:', JSON.stringify(q, null, 1));
    } catch (e) { console.log('query threw:', e.message, lastRaw); }
    require('fs').writeFileSync(`/tmp/init-${currency}.json`, JSON.stringify({ reference, init }));
  }
})();
