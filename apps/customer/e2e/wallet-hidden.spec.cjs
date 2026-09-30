const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

// While the wallet is switched off (FEATURES.walletEnabled off, WALLET_ENABLED
// unset) it isn't mentioned anywhere: no menu item, no page, nothing in the
// Terms. An old /wallet link lands on the client's appointments.
test.describe('Wallet switched off', () => {
    test('there is no wallet page or menu item', async ({ page }) => {
        await login(page, SEED.customer);
        await page.goto('/wallet');
        await expect(page).toHaveURL(/\/appointments$/);
        await expect(page.getByRole('link', { name: /wallet/i })).toHaveCount(0);
    });

    test('the Terms never mention a wallet', async ({ page }) => {
        await page.goto('/terms');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('main')).not.toContainText(/wallet/i);
    });
});
