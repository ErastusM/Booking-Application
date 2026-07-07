const { test, expect } = require('@playwright/test');
const { SEED, login, CUSTOMER_URL } = require('./helpers.cjs');

/**
 * Cross-app SSO (DUAL_APP_SPEC §4.3): one login, both apps. The refresh
 * cookie is set by the API origin, so a session started on the customer app
 * must bootstrap silently when the same browser opens the business app.
 */
test.describe('Cross-app single sign-on', () => {
    test('a provider signed in on the customer app is already signed in here', async ({ page }) => {
        await login(page, SEED.provider, CUSTOMER_URL);

        await page.goto('/dashboard');
        // bootstrapSession must authenticate from the shared refresh cookie —
        // landing back on /login would mean SSO is broken.
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
        await expect(page.getByText(SEED.providerName).first()).toBeVisible();
    });
});
