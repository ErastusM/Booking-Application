const { test, expect } = require('@playwright/test');

test.describe('Public pages', () => {
    test('home page loads', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/Bookplus/i);
    });

    test('login page renders the form', async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
        await expect(page.getByPlaceholder('••••••••')).toBeVisible();
        await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    });

    test('provider discovery page lists the seeded provider', async ({ page }) => {
        await page.goto('/services');
        await expect(page.getByText('E2E Barber', { exact: false })).toBeVisible({ timeout: 15_000 });
    });
});
