const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

test.describe('Cancellation policy setting', () => {
    test('provider can change the notice window and it persists', async ({ page }) => {
        await login(page, SEED.provider);
        await page.goto('/account');

        // An app-styled picker (@bookplus/ui Select): the trigger button carries
        // the current value in data-value and the list opens in a popup.
        const policySelect = page.getByTestId('cancellation-policy');
        await expect(policySelect).toBeVisible();
        // The model default is 0 — "Clients can cancel anytime". This spec used
        // to assert 24 and call it "the model default"; nothing in User.js has
        // ever set that, so it could only fail. A new provider starts with no
        // notice window and opts into one, which is what the rest of this test
        // exercises.
        await expect(policySelect).toHaveAttribute('data-value', '0');
        await expect(policySelect).toHaveText(/Clients can cancel anytime/);

        await policySelect.click();
        await page.getByTestId('cancellation-policy-popup').getByRole('option', { name: 'At least 48 hours before' }).click();
        await expect(policySelect).toHaveAttribute('data-value', '48');
        await page.getByRole('button', { name: /save changes/i }).click();
        await expect(page.getByText('Profile saved!')).toBeVisible();

        await page.reload();
        await expect(policySelect).toHaveAttribute('data-value', '48');
    });
});
