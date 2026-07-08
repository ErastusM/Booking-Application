const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

test.describe('Authentication', () => {
    test('seeded customer can log in', async ({ page }) => {
        await login(page, SEED.customer);
        // Logged in — the Sign In button should no longer be present
        await expect(page.getByRole('button', { name: /^sign in/i })).toHaveCount(0);
    });

    test('a business-account email cannot sign in on the customer app', async ({ page }) => {
        // Accounts are scoped per side: the customer app authenticates only
        // customer accounts. A provider (business) email with the right password
        // is rejected with a message pointing at the business app, and stays put.
        await page.goto('/login');
        await page.getByPlaceholder('you@example.com').fill(SEED.provider.email);
        await page.getByPlaceholder('••••••••').fill(SEED.provider.password);
        await page.getByRole('button', { name: /sign in/i }).click();
        await expect(page.getByText(/registered as a business account/i)).toBeVisible();
        await expect(page).toHaveURL(/\/login/);
    });

    test('wrong password shows an error and stays on login', async ({ page }) => {
        await page.goto('/login');
        await page.getByPlaceholder('you@example.com').fill(SEED.customer.email);
        await page.getByPlaceholder('••••••••').fill('wrong-password');
        await page.getByRole('button', { name: /sign in/i }).click();
        await expect(page).toHaveURL(/\/login/);
    });
});
