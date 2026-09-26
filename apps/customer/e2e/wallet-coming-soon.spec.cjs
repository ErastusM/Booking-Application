const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

// Wallet "coming soon" (FEATURES.walletEnabled off, WALLET_ENABLED unset): the
// wallet page shows the coming-soon tile instead of top-ups and gift cards.
test.describe('Wallet coming soon', () => {
    test('the wallet page says coming soon and offers no top-up', async ({ page }) => {
        await login(page, SEED.customer);
        await page.goto('/wallet');
        const tile = page.getByTestId('wallet-coming-soon');
        await expect(tile).toBeVisible();
        await expect(tile).toContainText('Wallet — coming soon');
        await expect(tile).toContainText('Pay at your appointment for now.');
        await expect(page.getByRole('button', { name: /top up/i })).toHaveCount(0);
        await expect(page.getByTestId('redeem-gift')).toHaveCount(0);
    });
});
