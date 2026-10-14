const { test, expect } = require('@playwright/test');
const { SEED, adminWithTwoStep, adminConsoleLogin, adminSection } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;

/**
 * The admin console (/bkplus-command): the admin door and the non-admin
 * notice, every section from the sidebar, the No-show filter, the Business
 * column and guest names, suspending a business (it leaves the customer
 * listing and comes back), Make / Remove admin, crediting a business that has
 * no wallet yet, and the phone menu. Everything it changes is on a business
 * built for it (/__e2e/admin-fixture), never the seeded one other specs book.
 */
// Every admin request needs two-step sign-in, so each test signs in a fresh
// admin with it on (password, then the code). Returns that admin.
async function adminLogin(page, request) {
    const admin = await adminWithTwoStep(request);
    await adminConsoleLogin(page, admin);
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    return admin;
}

const confirmDialog = (page) => page.getByRole('alertdialog');

test.describe('Admin console', () => {
    test('a non-admin at the admin door sees the notice, then is taken home', async ({ page }) => {
        await page.goto('/bkplus-command/login');
        await page.getByLabel('Admin email').fill(SEED.provider.email);
        await page.getByLabel('Password').fill(SEED.provider.password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        const notice = page.getByTestId('not-admin-notice');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('This account isn’t an admin');
        await expect(notice).toContainText('business owner');
        await expect(notice.getByRole('button', { name: 'Go now' })).toBeVisible();
        // Still on the admin door while the note is up…
        expect(new URL(page.url()).pathname).toBe('/bkplus-command/login');
        // …then home.
        await page.waitForURL(/\/dashboard/, { timeout: 8_000 });
    });

    test('every section loads; No-show filter; Business column and guest names', async ({ page, request }) => {
        const fx = await (await request.post(`${API}/__e2e/admin-fixture`)).json();
        await adminLogin(page, request);

        // Overview: four server-side figures, and what needs someone.
        const figures = page.getByTestId('overview-figures');
        for (const label of ['Bookings', 'Users', 'Active services', 'Revenue']) {
            await expect(figures.getByText(label, { exact: true })).toBeVisible();
        }
        await expect(page.getByTestId('needs-you')).toContainText('Go-live checklist');

        // Bookings: Business column, the guest row named and tagged.
        await adminSection(page, 'Bookings');
        await expect(page.getByRole('columnheader', { name: 'Business' })).toBeVisible();
        const guestRow = page.getByRole('row').filter({ hasText: fx.guestName });
        await expect(guestRow).toBeVisible();
        await expect(guestRow.getByText('Guest', { exact: true })).toBeVisible();
        await expect(guestRow.getByText(fx.businessName)).toBeVisible();

        // No-show filter: only no-shows (it used to return everything).
        await page.getByRole('button', { name: 'No-show', exact: true }).click();
        await expect(page.getByRole('button', { name: 'No-show', exact: true })).toHaveAttribute('aria-pressed', 'true');
        const noShowRow = page.getByRole('row').filter({ hasText: fx.noShowName });
        await expect(noShowRow).toBeVisible();
        await expect(noShowRow.getByText('Walk-in', { exact: true })).toBeVisible();
        await expect(page.getByRole('row').filter({ hasText: fx.guestName })).toHaveCount(0);
        await expect(page.getByText(/^\d+ no-show$/)).toBeVisible();

        // Each other section loads.
        await adminSection(page, 'Services');
        await expect(page.getByRole('button', { name: 'Add a service' })).toBeVisible();
        await adminSection(page, 'Users');
        await expect(page.getByLabel('Search users by name or email')).toBeVisible();
        await adminSection(page, 'Revenue');
        await expect(page.getByText('Total revenue').first()).toBeVisible();
        await adminSection(page, 'Wallets');
        await expect(page.getByRole('heading', { name: 'Top-ups from businesses' })).toBeVisible();

        // Insights uses the same definition of users and names no-shows.
        await adminSection(page, 'Insights');
        await expect(page.getByText('Users are clients and business owners. Team members and admins are counted separately.')).toBeVisible();
        await expect(page.getByText('No-show', { exact: true })).toBeVisible();
        // An old link still lands on it.
        await page.goto('/bkplus-command/insights');
        await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();
    });

    test('suspending a business takes it out of the customer listing; activating brings it back', async ({ page, request }) => {
        const fx = await (await request.post(`${API}/__e2e/admin-fixture`)).json();
        const listed = async () => ((await (await request.get(`${API}/api/providers`)).json()).data || [])
            .some((p) => p._id === fx.providerId);
        expect(await listed()).toBe(true);

        await adminLogin(page, request);
        await adminSection(page, 'Users');
        await page.getByLabel('Search users by name or email').fill(fx.ownerEmail);
        const row = page.getByRole('row').filter({ hasText: fx.ownerEmail });
        await expect(row).toBeVisible();
        await expect(row.getByText('Business owner')).toBeVisible();

        await row.getByRole('button', { name: 'Suspend' }).click();
        await expect(confirmDialog(page)).toContainText('Activate the account to bring everything back.');
        await confirmDialog(page).getByRole('button', { name: 'Suspend' }).click();
        await expect(row.getByText('Suspended', { exact: true })).toBeVisible();
        await expect.poll(listed).toBe(false);
        const profile = await request.get(`${API}/api/providers/${fx.providerId}`);
        expect(profile.status()).toBe(404);
        expect((await profile.json()).code).toBe('provider_unavailable');

        await row.getByRole('button', { name: 'Activate' }).click();
        await confirmDialog(page).getByRole('button', { name: 'Activate' }).click();
        await expect(row.getByText('Active', { exact: true })).toBeVisible();
        await expect.poll(listed).toBe(true);
    });

    test('Make admin, then Remove admin; your own row has no actions; staff get no Make admin', async ({ page, request }) => {
        const fx = await (await request.post(`${API}/__e2e/admin-fixture`)).json();
        const me = await adminLogin(page, request);
        await adminSection(page, 'Users');

        const search = page.getByLabel('Search users by name or email');
        await search.fill(me.email);
        await expect(page.getByRole('row').filter({ hasText: me.email }).getByText('Your own account: no actions')).toBeVisible();

        await search.fill(SEED.staff.email);
        const staffRow = page.getByRole('row').filter({ hasText: SEED.staff.email });
        await expect(staffRow.getByText(/^Staff · /)).toBeVisible();
        await expect(staffRow.getByRole('button', { name: 'Make admin' })).toHaveCount(0);

        await search.fill(fx.clientEmail);
        const row = page.getByRole('row').filter({ hasText: fx.clientEmail });
        await row.getByRole('button', { name: 'Make admin' }).click();
        await confirmDialog(page).getByRole('button', { name: 'Grant access' }).click();
        await expect(row.getByText('Admin', { exact: true })).toBeVisible();
        // Another admin: Remove admin offered, Delete disabled until then.
        await expect(row.getByRole('button', { name: 'Delete' })).toBeDisabled();

        await row.getByRole('button', { name: 'Remove admin' }).click();
        await expect(confirmDialog(page)).toContainText('customer');
        await confirmDialog(page).getByRole('button', { name: 'Remove admin' }).click();
        await expect(row.getByText('Customer', { exact: true })).toBeVisible();
        await expect(row.getByRole('button', { name: 'Make admin' })).toBeVisible();
    });

    test('credit a business that has no wallet yet', async ({ page, request }) => {
        const fx = await (await request.post(`${API}/__e2e/admin-fixture`)).json();
        await adminLogin(page, request);
        await adminSection(page, 'Wallets');
        await page.getByRole('button', { name: 'Credit or debit a business' }).click();
        const dialog = page.getByTestId('wallet-adjust-dialog');
        await dialog.getByLabel('Search businesses').fill(fx.businessName);
        const pick = dialog.getByRole('button', { name: new RegExp(fx.businessName) });
        await expect(pick).toContainText('No wallet yet');
        await pick.click();
        await dialog.getByLabel('Amount (N$)').fill('125');
        await dialog.getByLabel('Reason').fill('Launch credit');
        await dialog.getByRole('button', { name: `Credit N$125.00 to ${fx.businessName}` }).click();
        await expect(page.getByText(`Credited N$125.00 to ${fx.businessName} · new balance N$125.00`)).toBeVisible();
        // It now has a balance row.
        await expect(page.getByRole('row').filter({ hasText: fx.businessName }).getByText('N$125.00')).toBeVisible();
    });

    test('on a phone the sections are behind the menu button', async ({ page, request }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await adminLogin(page, request);
        const nav = page.getByRole('navigation', { name: 'Admin' });
        await expect(nav).toBeHidden();
        await page.getByRole('button', { name: 'Open menu' }).click();
        await expect(nav).toBeVisible();
        await nav.getByRole('link', { name: /^Wallets/ }).click();
        await expect(page.getByRole('heading', { name: 'Wallets', level: 1 })).toBeVisible();
        await expect(nav).toBeHidden();
        // Escape closes it too.
        await page.getByRole('button', { name: 'Open menu' }).click();
        await page.keyboard.press('Escape');
        await expect(nav).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
