const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * Sessions are now scoped per side (customer vs business). Cross-app SSO no
 * longer bridges the two sides — but WITHIN a side, the refresh cookie still
 * re-establishes a session after the access token is gone (reopen / token
 * expiry). This verifies the business app bootstraps its own session from the
 * business-scoped refresh cookie.
 */
test.describe('Business-side session persistence', () => {
    test('a provider is re-authenticated from the refresh cookie after the token is cleared', async ({ page }) => {
        await login(page, SEED.provider);
        await page.waitForURL(/\/dashboard/);

        // Drop the access token but keep the httpOnly refresh cookie, then reload.
        await page.evaluate(() => localStorage.removeItem('token'));
        await page.goto('/dashboard');

        // bootstrapSession must exchange the business-scoped cookie for a fresh
        // token — landing back on /login would mean persistence is broken.
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
        await expect(page.getByText(SEED.providerName).first()).toBeVisible();
    });
});
