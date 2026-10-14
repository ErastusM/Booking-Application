const { test, expect } = require('@playwright/test');
const { totp, adminWithTwoStep } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;

/**
 * Two-step sign-in for admin accounts and the Money tab behind it: once it is
 * on, a password alone stops at the code step (from the admin door and from
 * the standard business login), and the code opens the console with the money
 * controls available for this session.
 */

test.describe('Admin two-step sign-in', () => {
    test('the admin door asks for the code, then the Money tab is open', async ({ page, request }) => {
        const admin = await adminWithTwoStep(request);
        await page.goto('/bkplus-command/login');
        await page.getByLabel('Admin email').fill(admin.email);
        await page.getByLabel('Password').fill(admin.password);
        await page.getByRole('button', { name: /enter console/i }).click();

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
        await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();

        await page.getByRole('tab', { name: 'Money' }).click();
        const panel = page.getByTestId('money-panel');
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('heading', { name: 'Before payments go live' })).toBeVisible();
        await expect(panel.getByTestId('launch-providerApproved')).toContainText('To do');
        await expect(panel.getByRole('heading', { name: 'Simulator' })).toBeVisible();

        // At phone width the wide tables scroll inside their cards; the page never scrolls sideways.
        await page.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        for (const tab of ['Payments', 'Payouts', 'Disputes', 'Approvals', 'Audit log', 'Settings']) {
            await panel.getByRole('tab', { name: tab }).click();
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
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

    test('an admin without it is asked to set it up on the Money tab', async ({ page, request }) => {
        const admin = await (await request.post(`${API}/__e2e/fresh-admin`)).json();
        await page.goto('/bkplus-command/login');
        await page.getByLabel('Admin email').fill(admin.email);
        await page.getByLabel('Password').fill(admin.password);
        await page.getByRole('button', { name: /enter console/i }).click();
        await page.waitForURL(/\/bkplus-command$/, { timeout: 15_000 });
        await page.getByRole('tab', { name: 'Money' }).click();
        await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
        await page.getByRole('button', { name: 'Start set-up' }).click();
        await expect(page.getByAltText(/QR code/)).toBeVisible();
    });
});
