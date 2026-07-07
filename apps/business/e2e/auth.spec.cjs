const { test, expect } = require('@playwright/test');
const { SEED, login, CUSTOMER_URL } = require('./helpers.cjs');

test.describe('Business app roles', () => {
    test('a provider lands on the dashboard', async ({ page }) => {
        await login(page, SEED.provider);
        await page.waitForURL(/\/dashboard/);
        await expect(page.getByText(SEED.providerName).first()).toBeVisible();
    });

    test('a customer is handed off to the customer app', async ({ page }) => {
        await login(page, SEED.customer);
        // ProtectedRoute sends non-business roles across to the customer app.
        await page.waitForURL((url) => url.origin === CUSTOMER_URL, { timeout: 15_000 });
    });
});
