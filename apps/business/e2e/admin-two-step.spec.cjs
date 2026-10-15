const { test, expect } = require('@playwright/test');
const { totp, adminWithTwoStep, adminSection } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;

/**
 * Two-step sign-in for admin accounts: once it is on, a password alone stops
 * at the code step (from the admin door and from the standard business login),
 * and the code opens the console, money controls included, for this session.
 * Without it, an admin sets it up before the console opens.
 */

test.describe('Admin two-step sign-in', () => {
    test('the admin door asks for the code, then the Money tab is open', async ({ page, request }) => {
        const admin = await adminWithTwoStep(request);
        await page.goto('/bkplus-command/login');
        await page.getByLabel('Admin email').fill(admin.email);
        await page.getByLabel('Password').fill(admin.password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();

        // The password alone doesn't open it.
        const code = page.getByTestId('admin-mfa-code');
        await expect(code).toBeVisible();
        await code.fill('000000');
        await page.getByRole('button', { name: /confirm/i }).click();
        await expect(page.getByRole('alert')).toContainText('not accepted');
        expect(new URL(page.url()).pathname).toBe('/bkplus-command/login');

        // The code used to turn it on can't be replayed; the next one works.
        await code.fill(totp(admin.secret, 1));
        await page.getByRole('button', { name: /confirm/i }).click();
        await page.waitForURL(/\/bkplus-command$/, { timeout: 15_000 });
        await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

        // Money → Dashboard points to what is left before launch.
        await adminSection(page, 'Dashboard');
        await expect(page.getByTestId('finance-dashboard')).toBeVisible();
        await expect(page.getByTestId('dash-launch')).toContainText('Online payments are off');
        await page.getByRole('button', { name: 'See the checklist' }).click();
        await expect(page).toHaveURL(/\/bkplus-command\/settings\/go-live$/);
        await expect(page.getByRole('heading', { name: 'Before payments go live' })).toBeVisible();
        await expect(page.getByTestId('launch-providerApproved')).toContainText('To do');
        await adminSection(page, 'Prices and fees');
        await expect(page.getByRole('heading', { name: 'Simulator' })).toBeVisible();

        // At phone width the wide tables scroll inside their panels; the page never scrolls sideways.
        await page.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        // Every section, by its sidebar name and its page title, measured once it has loaded.
        const sections = [
            ['Overview'], ['Bookings'], ['Users'], ['Services'], ['Revenue'], ['Wallets'], ['Insights'],
            ['Dashboard'], ['Payments'], ['Payouts'], ['Disputes'], ['Approvals'], ['Costs', 'Running costs'],
            ['Prices and fees'], ['Go-live checklist'], ['Admins and roles'], ['Audit log'],
        ];
        for (const [section, title = section] of sections) {
            await adminSection(page, section);
            await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
            await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 15_000 });
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), { message: section }).toBeLessThanOrEqual(0);
        }
    });

    test('the standard business login hands an admin to the code step', async ({ page, request }) => {
        const admin = await adminWithTwoStep(request);
        await page.goto('/login');
        await page.getByPlaceholder('you@example.com').fill(admin.email);
        await page.getByPlaceholder('••••••••').fill(admin.password);
        await page.getByRole('button', { name: /sign in/i }).click();
        await page.waitForURL(/\/bkplus-command\/login$/, { timeout: 15_000 });
        await expect(page.getByTestId('admin-mfa-code')).toBeVisible();
        await page.getByTestId('admin-mfa-code').fill(totp(admin.secret, 1));
        await page.getByRole('button', { name: /confirm/i }).click();
        await page.waitForURL(/\/bkplus-command$/, { timeout: 15_000 });
    });

    test('an admin without it is asked to set it up before the console opens', async ({ page, request }) => {
        const admin = await (await request.post(`${API}/__e2e/fresh-admin`)).json();
        await page.goto('/bkplus-command/login');
        await page.getByLabel('Admin email').fill(admin.email);
        await page.getByLabel('Password').fill(admin.password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.waitForURL(/\/bkplus-command$/, { timeout: 15_000 });
        // Nothing of the console until it is on: the API refuses admin requests without it.
        await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
        await expect(page.getByTestId('admin-console')).toHaveCount(0);
        await page.getByRole('button', { name: 'Start set-up' }).click();
        await expect(page.getByAltText(/QR code/)).toBeVisible();
        const secret = (await page.getByTestId('mfa-secret').innerText()).replace(/\s+/g, '');
        await page.getByLabel('Enter the 6-digit code the app shows').fill(totp(secret));
        await page.getByRole('button', { name: 'Turn on' }).click();
        await expect(page.getByTestId('mfa-recovery-codes')).toBeVisible();
        await page.getByRole('button', { name: 'I saved them' }).click();
        await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
        await adminSection(page, 'Users');
        await expect(page.getByLabel('Search users by name or email')).toBeVisible();
    });
});
