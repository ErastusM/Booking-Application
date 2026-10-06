// Temporary: complete a TEST payment on PayGate's hosted page with PayGate's
// public test card, then Query, verify the return checksum, and refund.
process.env.PAYGATE_ID = '10011072130';
process.env.PAYGATE_PASSWORD = 'test';
const pg = require('../../apps/api/src/services/paygate');
const { chromium } = require(process.env.PW_DIR + '/node_modules/playwright');
const crypto = require('crypto');

let lastRaw = '';
const https = require('https');
pg.setTransport((a) => new Promise((resolve, reject) => {
  const u = new URL(a.endpoint);
  const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: a.soapAction, 'Content-Length': Buffer.byteLength(a.body) } }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { lastRaw = d; resolve({ status: res.statusCode, body: d }); });
  });
  req.on('error', reject); req.write(a.body); req.end();
}));

(async () => {
  const reference = 'BP' + crypto.randomBytes(15).toString('hex');
  const init = await pg.initiate({ reference, amountCents: 12345, currency: 'NAD',
    customer: { firstName: 'Test', lastName: 'Client', email: 'test@example.com' },
    notifyUrl: 'https://example.com/notify', returnUrl: 'https://example.com/return' });
  console.log('initiate ok:', init.ok, init.payRequestId);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  let returned = null;
  await page.route('https://example.com/**', async (route) => {
    returned = { url: route.request().url(), method: route.request().method(), body: route.request().postData() };
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>returned</p>' });
  });
  const inputs = Object.entries(init.fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`).join('');
  await page.setContent(`<form id="f" method="POST" action="${init.redirectUrl}">${inputs}</form><script>document.getElementById('f').submit()</script>`);
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  console.log('\n== PayGate page:', page.url());
  const describe = async () => page.$$eval('input, select, button', (els) => els.map((e) => `${e.tagName.toLowerCase()} name=${e.name || ''} id=${e.id || ''} type=${e.type || ''} value=${e.type === 'hidden' ? '(hidden)' : (e.value || '').slice(0, 20)} text=${(e.innerText || '').trim().slice(0, 30)}`));
  console.log((await describe()).join('\n'));
  console.log('page text:', (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 600));

  // Fill whatever card form PayGate shows, by the usual field names.
  const fill = async (re, value) => {
    const els = await page.$$('input:not([type=hidden]), select');
    for (const el of els) {
      const key = ((await el.getAttribute('name')) || '') + ' ' + ((await el.getAttribute('id')) || '') + ' ' + ((await el.getAttribute('placeholder')) || '');
      if (re.test(key)) {
        const tag = await el.evaluate((n) => n.tagName);
        if (tag === 'SELECT') {
          const opts = await el.$$eval('option', (o) => o.map((x) => x.value).filter(Boolean));
          const pick = opts.find((o) => o.endsWith(value)) || opts[opts.length - 1];
          await el.selectOption(pick);
        } else { await el.fill(value); }
        return key.trim();
      }
    }
    return null;
  };
  // Some PayGate pages first ask for a payment method.
  const cardChoice = await page.$('text=/credit card|card/i');
  console.log('filled:',
    await fill(/card.?(num|no)|pan|ccnum/i, '4000000000000002'),
    await fill(/holder|name.?on|cardname/i, 'Test Client'),
    await fill(/exp.*(mon|mm)|month/i, '12'),
    await fill(/exp.*(year|yy)|year/i, String(new Date().getFullYear() + 2)),
    await fill(/^exp(iry)?\b|expir(y|ation)(?!.*(mon|year))/i, '12/' + String((new Date().getFullYear() + 2) % 100)),
    await fill(/cvv|cvc|security/i, '123'));
  const submit = await page.$('button[type=submit], input[type=submit], button:has-text("Pay"), button:has-text("Confirm")');
  if (submit) { await Promise.all([page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}), submit.click()]); }
  for (let i = 0; i < 30 && !returned; i++) await page.waitForTimeout(1000);
  console.log('\n== after submit:', page.url());
  console.log('page text:', (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 400));
  console.log('\n== RETURN POST to our site:', JSON.stringify(returned));
  await browser.close();

  if (returned && returned.body) {
    const p = Object.fromEntries(new URLSearchParams(returned.body));
    for (const key of ['test', 'secret']) {
      console.log(`return checksum with key "${key}":`,
        pg.verifyReturnChecksum({ paygateId: '10011072130', payRequestId: p.PAY_REQUEST_ID, transactionStatus: p.TRANSACTION_STATUS, reference, checksum: p.CHECKSUM }, key),
        '| md5 of posted values:', pg.verifyPostedChecksum(Object.entries(p), key));
    }
  }

  console.log('\n== QUERY after payment');
  const q = await pg.query({ payRequestId: init.payRequestId });
  console.log('RAW:', lastRaw);
  console.log('PARSED:', JSON.stringify(q));

  if (q.transactionId) {
    console.log('\n== REFUND part (N$ 23.45)');
    const r = await pg.refund({ transactionId: q.transactionId, amountCents: 2345 });
    console.log('RAW:', lastRaw);
    console.log('PARSED:', JSON.stringify(r));
    console.log('\n== QUERY after refund');
    const q2 = await pg.query({ payRequestId: init.payRequestId });
    console.log('RAW:', lastRaw);
  }
})().catch((e) => { console.error('FAILED:', e && e.stack || e); console.log('last raw:', lastRaw); process.exit(1); });
