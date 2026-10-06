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

async function attempt(card) {
  console.log('\n\n######## CARD', card.slice(0,6)+'…'+card.slice(-4));
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
  console.log('page text:', (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 600));

  const clickIfVisible = async (sel) => { const el = await page.$(sel); if (el && await el.isVisible()) { await el.click(); return true; } return false; };
  await page.waitForTimeout(1000);
  console.log('dismissed test notice:', await clickIfVisible('button:visible:has-text("OK")'));
  console.log('chose Card:', await clickIfVisible('#pmCreditcardBtn'));
  await page.waitForSelector('#ccNumber', { state: 'visible', timeout: 15000 });
  await page.fill('#ccNumber', card);
  await page.fill('#ccName', 'Test Client');
  await page.selectOption('#ccOpMonth', '12');
  const years = await page.$$eval('#ccOpYear option', (o) => o.map((x) => x.value));
  await page.selectOption('#ccOpYear', years[Math.min(2, years.length - 1)]);
  await page.fill('#ccCvv', '123');
  await Promise.all([page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}), page.click('#nextBtn')]);
  // Any further steps (3-D Secure simulator, confirmation) until PayGate posts back to us.
  for (let step = 0; step < 6 && !returned; step++) {
    await page.waitForTimeout(2000);
    if (returned) break;
    const frames = page.frames();
    console.log(`\n-- step ${step}: ${page.url()} (frames: ${frames.length})`);
    for (const fr of frames) {
      const t = await fr.innerText('body').catch(() => '');
      if (t.trim()) console.log('   text:', t.replace(/\s+/g, ' ').slice(0, 300));
      const btns = await fr.$$eval('button, input[type=submit], input[type=button], a.btn', (els) => els.filter((e) => e.offsetParent !== null).map((e) => (e.innerText || e.value || '').trim()).filter(Boolean)).catch(() => []);
      if (btns.length) console.log('   buttons:', btns.join(' | '));
      const pick = await fr.$('button:visible:has-text("Authenticate"), button:visible:has-text("Submit"), input[type=submit]:visible, button:visible:has-text("Continue"), button:visible:has-text("Approve"), button:visible:has-text("Next"), button:visible:has-text("Pay")').catch(() => null);
      if (pick) { await Promise.all([page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {}), pick.click().catch(() => {})]); break; }
    }
  }
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
}
(async () => {
  for (const card of ['5200000000000015', '4000000000000002', '4111111111111111', '5200000000000007']) {
    try { await attempt(card); } catch (e) { console.log('attempt failed:', e && e.message); }
  }
})();
