const { test, expect } = require('@playwright/test');
const { SEED, login, CUSTOMER_URL } = require('./helpers.cjs');

test.describe('Business app roles', () => {
    test('a provider lands on the dashboard', async ({ page }) => {
        await login(page, SEED.provider);
        await page.waitForURL(/\/dashboard/);
        await expect(page.getByText(SEED.providerName).first()).toBeVisible();
    });

    test('a customer-account email cannot sign in on the business app', async ({ page }) => {
        // Accounts are scoped per side: the business app authenticates only
        // business accounts. A customer email with the right password is
        // rejected with a message pointing at the customer app, and stays put.
        await page.goto('/login');
        await page.getByPlaceholder('you@example.com').fill(SEED.customer.email);
        await page.getByPlaceholder('••••••••').fill(SEED.customer.password);
        await page.getByRole('button', { name: /sign in/i }).click();
        await expect(page.getByText(/registered as a customer account/i)).toBeVisible();
        await expect(page).toHaveURL(/\/login/);
    });
});
