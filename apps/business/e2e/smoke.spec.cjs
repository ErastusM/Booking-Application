const { test, expect } = require('@playwright/test');

test.describe('Business app smoke', () => {
    test('unauthenticated visit is walled off at /login', async ({ page }) => {
        await page.goto('/');
        await page.waitForURL(/\/login/);
        await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    });

    test('deep links are protected too', async ({ page }) => {
        await page.goto('/team');
        await page.waitForURL(/\/login/);
    });

    // The provider-facing legal pages must be readable WITHOUT signing in — the
    // signup consent links to them before an account exists.
    test('legal pages are public', async ({ page }) => {
        await page.goto('/terms');
        await expect(page).toHaveURL(/\/terms/);
        await expect(page.getByRole('heading', { name: /Business Terms of Service/i })).toBeVisible();

        await page.goto('/privacy-policy');
        await expect(page).toHaveURL(/\/privacy-policy/);
        await expect(page.getByRole('heading', { name: /Business Privacy Policy/i })).toBeVisible();
    });
});
