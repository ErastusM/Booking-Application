const { test, expect } = require('@playwright/test');
const { SEED, CUSTOMER_URL, expectProviderDashboard } = require('./helpers.cjs');

/**
 * Role-aware login routing.
 *
 * A login authenticates first, then routes by account type. Two rules:
 *
 *  - www (the customer app) is the ambiguous door — someone arriving there has
 *    not said which side they mean. Business credentials hand off to the
 *    business app; an email holding BOTH accounts is asked "Where would you like
 *    to go?" rather than having a side picked for it. Crucially the question is
 *    "does a business account EXIST on this email", not "does this password also
 *    open it": the two sides routinely keep different passwords, and those
 *    people used to be dropped on the customer site with no choice at all.
 *
 *  - business.bookplus.pro is NOT ambiguous. Opening it IS the choice, so it
 *    signs the business account straight in and never asks again.
 *
 * These drive the real cross-origin flow — both apps and the API are running.
 */

const fillLogin = async (page, { email, password }) => {
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
};

test.describe('The website (www) routes by account type', () => {
    test('business credentials on the website land on the business dashboard', async ({ page, baseURL }) => {
        await page.goto(`${CUSTOMER_URL}/login`);
        await fillLogin(page, SEED.provider);

        // Handed off to the business origin, already signed in.
        await page.waitForURL((url) => url.origin === new URL(baseURL).origin, { timeout: 20_000 });
        await expectProviderDashboard(page);
    });

    test('a dual-account email is asked where to go → Business Dashboard', async ({ page, baseURL }) => {
        await page.goto(`${CUSTOMER_URL}/login`);
        await fillLogin(page, SEED.dual);

        const chooser = page.getByTestId('destination-chooser');
        await expect(chooser).toBeVisible();
        await expect(chooser).toContainText('Where would you like to go?');

        await page.getByTestId('choose-business').click();
        // Same password on both sides, so they are carried across signed in.
        await page.waitForURL((url) => url.origin === new URL(baseURL).origin, { timeout: 20_000 });
        // A real session must exist, not just the right URL: the avatar menu
        // renders only when useAuth has a user, so it fails if the cross-origin
        // hand-off did not establish the session.
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
        await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible({ timeout: 20_000 });
    });

    test('a dual-account email can choose the Customer Site', async ({ page }) => {
        await page.goto(`${CUSTOMER_URL}/login`);
        await fillLogin(page, SEED.dual);

        await expect(page.getByTestId('destination-chooser')).toBeVisible();
        await page.getByTestId('choose-customer').click();

        await page.waitForURL((url) => url.origin === new URL(CUSTOMER_URL).origin && !url.pathname.includes('/login'), { timeout: 20_000 });
        // ...and the customer session was COMMITTED, not merely routed to — the
        // navbar avatar menu renders only when useAuth has a user.
        await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    });

    // The regression the tester reported: two profiles, two passwords, no choice.
    test('a dual-account email whose sides have DIFFERENT passwords still gets the choice', async ({ page, baseURL }) => {
        await page.goto(`${CUSTOMER_URL}/login`);
        await fillLogin(page, { email: SEED.split.email, password: SEED.split.password });

        const chooser = page.getByTestId('destination-chooser');
        await expect(chooser).toBeVisible();
        // ...and it is honest that the business side has its own sign-in.
        await expect(chooser).toContainText('own sign-in');

        await page.getByTestId('choose-business').click();
        // No session is minted for an account nobody proved: they land on the
        // business sign-in with the email already filled in.
        await page.waitForURL((url) => url.origin === new URL(baseURL).origin && url.pathname.includes('/login'), { timeout: 20_000 });
        await expect(page.getByPlaceholder('you@example.com')).toHaveValue(SEED.split.email);
        await expect(page.getByTestId('from-website-note')).toBeVisible();

        // And that password does open it.
        await page.getByPlaceholder('••••••••').fill(SEED.split.businessPassword);
        await page.getByRole('button', { name: /sign in/i }).click();
        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
    });
});

test.describe('The business app does not ask twice', () => {
    test('a dual-account email signing in on the business app goes straight to the dashboard', async ({ page }) => {
        await page.goto('/login');
        await fillLogin(page, SEED.dual);

        await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
        await expect(page.getByTestId('destination-chooser')).toHaveCount(0);
    });

    test('customer credentials on the business app still hand off to the website', async ({ page }) => {
        await page.goto('/login');
        await fillLogin(page, SEED.customer);

        await page.waitForURL((url) => url.origin === new URL(CUSTOMER_URL).origin, { timeout: 20_000 });
        await expect(page).not.toHaveURL(/\/login/);
    });
});
