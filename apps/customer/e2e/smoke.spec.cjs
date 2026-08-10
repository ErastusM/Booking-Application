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

    // /services was folded into the home feed; the old path still redirects, and
    // shared links from that era must keep working.
    test('the old /services link still lands somewhere useful', async ({ page }) => {
        await page.goto('/services');
        await expect(page).toHaveURL(/\/$/);
    });

    test('the home feed lists the seeded provider', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('E2E Provider', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    });
});
