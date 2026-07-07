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
});
