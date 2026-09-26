// Business app: cookie consent (nothing tracked before "Accept analytics"),
// the minimum-age box on business sign-up, and "Finish signing up" for a
// first-time Google business sign-up (compliance audit points 5, 6, 15).
const { test, expect } = require('@playwright/test');

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;

test.describe('first visit', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('nothing is tracked before consent; tracking starts after "Accept analytics"', async ({ page }) => {
        const events = [];
        page.on('request', (r) => { if (r.url().includes('/api/events')) events.push(r); });
        const hide = () => page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        });

        await page.goto('/login');
        await expect(page.getByTestId('cookie-banner')).toBeVisible();
        await page.goto('/register');
        await hide();
        await page.waitForTimeout(13_000);
        await hide();
        expect(events).toHaveLength(0);
        expect(await page.evaluate(() => localStorage.getItem('bp_sid'))).toBeNull();

        await page.getByTestId('consent-analytics').click();
        const req = page.waitForRequest((r) => r.url().includes('/api/events') && r.method() === 'POST', { timeout: 20_000 });
        await page.goto('/login');
        await page.waitForTimeout(500);
        await hide();
        const body = JSON.parse((await req).postData());
        expect(body.app).toBe('business');
        expect(body.sessionId).toBe(await page.evaluate(() => localStorage.getItem('bp_sid')));
    });
});

test.describe('signed-in owner without a cookie choice', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('is not interrupted on the dashboard, and can choose from Account → Cookie settings', async ({ page }) => {
        const { SEED, login } = require('./helpers.cjs');
        // Sign in with the choice already made so the public login page's banner
        // is out of the way, then forget the choice to model an owner who never chose.
        await page.goto('/login');
        await page.evaluate(() => localStorage.setItem('bp_consent', JSON.stringify({ v: 1, analytics: false, at: new Date().toISOString() })));
        await login(page, SEED.provider);
        await page.evaluate(() => localStorage.removeItem('bp_consent'));
        await page.goto('/dashboard');
        await page.waitForTimeout(1500);
        await expect(page.getByTestId('cookie-banner')).toBeHidden();

        await page.goto('/account?section=settings');
        await page.getByTestId('cookie-settings-link').click();
        await expect(page.getByTestId('cookie-banner')).toBeVisible();
        await page.getByTestId('consent-necessary').click();
        await expect(page.getByTestId('cookie-banner')).toBeHidden();
        expect(JSON.parse(await page.evaluate(() => localStorage.getItem('bp_consent'))).analytics).toBe(false);
    });
});

test('business sign-up cannot be submitted without the age confirmation', async ({ page, request }) => {
    await page.goto('/register');
    const age = page.getByTestId('register-age');
    await expect(age).toBeVisible();
    await expect(age).not.toBeChecked();
    await expect(page.getByText(/I am 16 or older/)).toBeVisible();
    await expect(page.getByRole('button', { name: /List my business/i })).toBeDisabled();

    const res = await request.post(`${API}/api/auth/register`, {
        data: { name: 'Biz NoAge', email: `e2e-bizage-${Date.now()}@bookplus.dev`, password: 'Password1!', phone: '+264811234567', role: 'provider', providerCategory: 'Home services', termsAccepted: true },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('age_required');
});

test('first-time Google business sign-up finishes with Terms and age before the account exists', async ({ page, request }) => {
    const email = `e2e-gbiz-${Date.now()}@bookplus.dev`;
    const { code } = await (await request.post(`${API}/__e2e/google-pending`, { data: { email, role: 'provider', name: 'Gus Biz' } })).json();
    await page.goto(`/auth/callback?signup=${code}`);
    const form = page.getByTestId('finish-signup');
    await expect(form).toContainText('business account');
    await expect(page.getByTestId('finish-create')).toBeDisabled();
    await page.getByTestId('finish-terms').check();
    await page.getByTestId('finish-age').check();
    await page.getByTestId('finish-create').click();
    await page.waitForURL(/\/complete-profile/, { timeout: 15_000 });
});
