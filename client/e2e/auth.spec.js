const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers');

test.describe('Authentication', () => {
    test('seeded customer can log in', async ({ page }) => {
        await login(page, SEED.customer);
        // Logged in — the Sign In button should no longer be present
        await expect(page.getByRole('button', { name: /^sign in/i })).toHaveCount(0);
    });

    test('seeded provider lands on the dashboard', async ({ page }) => {
        await login(page, SEED.provider);
        await page.goto('/dashboard');
        await expect(page).toHaveURL(/\/dashboard/);
    });

    test('wrong password shows an error and stays on login', async ({ page }) => {
        await page.goto('/login');
        await page.getByPlaceholder('you@example.com').fill(SEED.customer.email);
        await page.getByPlaceholder('••••••••').fill('wrong-password');
        await page.getByRole('button', { name: /sign in/i }).click();
        await expect(page).toHaveURL(/\/login/);
    });
});
