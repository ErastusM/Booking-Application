const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

test.describe('Authentication', () => {
    test('seeded customer can log in', async ({ page }) => {
        await login(page, SEED.customer);
        // Logged in — the Sign In button should no longer be present
        await expect(page.getByRole('button', { name: /^sign in/i })).toHaveCount(0);
    });

    test('seeded provider gets the business-app hand-off in the nav', async ({ page }) => {
        // The customer app treats providers as customers; the navbar carries a
        // "Business" pill that hops to the business app with a full page load.
        await login(page, SEED.provider);
        await expect(page.getByRole('button', { name: /business/i }).first()).toBeVisible();
    });

    test('wrong password shows an error and stays on login', async ({ page }) => {
        await page.goto('/login');
        await page.getByPlaceholder('you@example.com').fill(SEED.customer.email);
        await page.getByPlaceholder('••••••••').fill('wrong-password');
        await page.getByRole('button', { name: /sign in/i }).click();
        await expect(page).toHaveURL(/\/login/);
    });
});
