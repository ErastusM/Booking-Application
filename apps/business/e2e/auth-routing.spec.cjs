const { test, expect } = require('@playwright/test');
const { SEED, CUSTOMER_URL, expectProviderDashboard } = require('./helpers.cjs');

/**
 * Role-aware login routing.
 *
 * A login authenticates first, then routes by account type: business
 * credentials entered on the CUSTOMER site hand the session off to the business
 * app (via the SSO cookie) instead of dead-ending with an error, and an email
 * that holds BOTH accounts gets asked "Where would you like to go?" rather than
 * having a side silently picked for it. These drive the real cross-origin flow
 * — both apps and the API are running.
 */

const fillLogin = async (page, { email, password }) => {
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
};

test.describe('Role-aware login routing', () => {
    test('business credentials on the CUSTOMER site land on the business dashboard', async ({ page, baseURL }) => {
        await page.goto(`${CUSTOMER_URL}/login`);
        await fillLogin(page, SEED.provider);

        // Handed off to the business origin, already signed in.
        await page.waitForURL((url) => url.origin === new URL(baseURL).origin, { timeout: 20_000 });
        await expectProviderDashboard(page);
    });

    test('a dual-account email on the business login is asked where to go → Business Dashboard', async ({ page }) => {
        await page.goto('/login');
        await fillLogin(page, SEED.dual);

        const chooser = page.getByTestId('destination-chooser');
        await expect(chooser).toBeVisible();
        await expect(chooser).toContainText('Where would you like to go?');

        await page.getByTestId('choose-business').click();
        await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
    });

    test('a dual-account email on the business login can choose the Customer Site', async ({ page }) => {
        await page.goto('/login');
        await fillLogin(page, SEED.dual);

        await expect(page.getByTestId('destination-chooser')).toBeVisible();
        await page.getByTestId('choose-customer').click();

        // Crosses to the customer origin, signed in via the SSO cookie — the
        // marketplace home renders (not its login page).
        await page.waitForURL((url) => url.origin === new URL(CUSTOMER_URL).origin, { timeout: 20_000 });
        await expect(page).not.toHaveURL(/\/login/);
    });
});
