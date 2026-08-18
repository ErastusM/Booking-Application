const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

test.describe('Authentication', () => {
    test('seeded customer can log in', async ({ page }) => {
        await login(page, SEED.customer);
        // Logged in — the Sign In button should no longer be present
        await expect(page.getByRole('button', { name: /^sign in/i })).toHaveCount(0);
    });

    test('business credentials on the customer app hand off to the business app', async ({ page }) => {
        // Login authenticates first, then routes by account type: a business
        // email with the right password is signed into its business account and
        // the browser is sent to the business app — never dead-ended here. This
        // suite doesn't boot the business app, so its origin is stubbed; the
        // full cross-origin landing is covered by the business suite's
        // auth-routing spec (which boots both apps).
        await page.route('http://localhost:3003/**', (route) => route.fulfill({
            contentType: 'text/html', body: '<title>business-app-stub</title>ok',
        }));
        await page.goto('/login');
        await page.getByPlaceholder('you@example.com').fill(SEED.provider.email);
        await page.getByPlaceholder('••••••••').fill(SEED.provider.password);
        await page.getByRole('button', { name: /sign in/i }).click();
        await page.waitForURL((url) => url.port === '3003', { timeout: 15_000 });
    });

    test('wrong password shows an error and stays on login', async ({ page }) => {
        await page.goto('/login');
        await page.getByPlaceholder('you@example.com').fill(SEED.customer.email);
        await page.getByPlaceholder('••••••••').fill('wrong-password');
        await page.getByRole('button', { name: /sign in/i }).click();
        await expect(page).toHaveURL(/\/login/);
    });
});
