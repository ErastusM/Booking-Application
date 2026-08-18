const { test, expect } = require('@playwright/test');
const { SEED, login, CUSTOMER_URL, expectProviderDashboard } = require('./helpers.cjs');

test.describe('Business app roles', () => {
    test('a provider lands on the dashboard', async ({ page }) => {
        await login(page, SEED.provider);
        await page.waitForURL(/\/dashboard/);
        await expectProviderDashboard(page);
    });

    test('customer credentials on the business app hand off to the customer site', async ({ page }) => {
        // Login authenticates first, then routes by account type: a customer
        // email with the right password is signed into its customer account and
        // the browser lands on the customer site (both apps run in this suite),
        // never dead-ended on the business login.
        await page.goto('/login');
        await page.getByPlaceholder('you@example.com').fill(SEED.customer.email);
        await page.getByPlaceholder('••••••••').fill(SEED.customer.password);
        await page.getByRole('button', { name: /sign in/i }).click();
        await page.waitForURL((url) => url.origin === new URL(CUSTOMER_URL).origin, { timeout: 20_000 });
        await expect(page).not.toHaveURL(/\/login/);
    });
});
