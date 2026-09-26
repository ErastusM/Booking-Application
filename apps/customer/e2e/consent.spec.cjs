// Cookie / analytics consent (compliance audit points 5 and 6): the banner is
// shown to a first-time visitor, NOTHING is tracked before "Accept analytics"
// (no /api/events request, no bp_sid), tracking starts after it, and
// withdrawing via "Cookie settings" deletes bp_sid.
const { test, expect } = require('@playwright/test');

// A first-time visitor: no stored cookie choice (the config presets one for
// every other spec so the banner stays out of their way).
test.use({ storageState: { cookies: [], origins: [] } });

// Telemetry batches on a 12s timer and flushes when the tab is hidden. Force the
// hidden-tab flush so the spec does not have to wait for the timer.
const forceFlush = (page) => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
const sid = (page) => page.evaluate(() => localStorage.getItem('bp_sid'));

test('nothing is tracked before consent; tracking starts after "Accept analytics"', async ({ page }) => {
    const events = [];
    page.on('request', (r) => { if (r.url().includes('/api/events')) events.push(r); });

    await page.goto('/');
    const banner = page.getByTestId('cookie-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy-policy');

    // Browse a bit without choosing: page views happen, nothing leaves the browser.
    await page.goto('/about');
    await page.goto('/login');
    await forceFlush(page);
    await page.waitForTimeout(13_000); // longer than the 12s batch timer
    await forceFlush(page);
    expect(events).toHaveLength(0);
    expect(await sid(page)).toBeNull();

    await page.getByTestId('consent-analytics').click();
    await expect(banner).toBeHidden();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bp_consent')));
    expect(stored.analytics).toBe(true);
    expect(Date.parse(stored.at)).not.toBeNaN();

    // The next page view is tracked, with a persistent id.
    const req = page.waitForRequest((r) => r.url().includes('/api/events') && r.method() === 'POST', { timeout: 20_000 });
    await page.goto('/register');
    await page.waitForTimeout(500);
    await forceFlush(page);
    const body = JSON.parse((await req).postData());
    expect(body.events.some((e) => e.name === 'page_view')).toBe(true);
    expect(body.sessionId).toBe(await sid(page));
    expect(await sid(page)).toBeTruthy();

    // The banner stays away on reload once a choice exists.
    await page.reload();
    await expect(page.getByTestId('cookie-banner')).toBeHidden();
});

test('"Only necessary" tracks nothing; "Cookie settings" reopens the choice and withdrawing deletes bp_sid', async ({ page }) => {
    const events = [];
    page.on('request', (r) => { if (r.url().includes('/api/events')) events.push(r); });

    await page.goto('/');
    await page.getByTestId('consent-necessary').click();
    await expect(page.getByTestId('cookie-banner')).toBeHidden();
    await page.goto('/about');
    await forceFlush(page);
    await page.waitForTimeout(1500);
    expect(events).toHaveLength(0);
    expect(await sid(page)).toBeNull();

    // Change of mind from the footer: accept…
    await page.getByTestId('cookie-settings-link').click();
    await expect(page.getByTestId('cookie-banner')).toBeVisible();
    await expect(page.getByTestId('cookie-banner')).toContainText('only necessary');
    await page.getByTestId('consent-analytics').click();
    await page.goto('/');
    await page.goto('/about');
    await forceFlush(page);
    await expect.poll(() => sid(page)).toBeTruthy();

    // …then withdraw: the id is deleted.
    await page.getByTestId('cookie-settings-link').click();
    await page.getByTestId('consent-necessary').click();
    expect(await sid(page)).toBeNull();
});
