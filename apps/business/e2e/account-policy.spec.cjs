const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

test.describe('Cancellation policy setting', () => {
    test('provider can change the notice window and it persists', async ({ page }) => {
        await login(page, SEED.provider);
        await page.goto('/account');

        const policySelect = page.locator('select', {
            has: page.locator('option', { hasText: 'Clients can cancel anytime' }),
        });
        await expect(policySelect).toBeVisible();
        await expect(policySelect).toHaveValue('24'); // model default

        await policySelect.selectOption('48');
        await page.getByRole('button', { name: /save changes/i }).click();
        await expect(page.getByText('Profile saved!')).toBeVisible();

        await page.reload();
        await expect(policySelect).toHaveValue('48');
    });
});
