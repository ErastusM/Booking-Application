const { test, expect } = require('@playwright/test');
const { SEED } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;
const ADMIN = { email: 'e2e-admin@bookplus.dev', password: 'Password1!' };

/**
 * The admin console (/bkplus-command) after the owner's "Fix 1-7":
 * the admin door and the non-admin notice, every tab, the No-show filter, the
 * Business column and guest names, suspending a business (it leaves the
 * customer listing and comes back), Make / Remove admin, and crediting a
 * business that has no wallet yet. Everything it changes is on a business
 * built for it (/__e2e/admin-fixture), never the seeded one other specs book.
 */
async function adminLogin(page) {
    await page.goto('/bkplus-command/login');
    await page.getByLabel('Admin email').fill(ADMIN.email);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: /enter console/i }).click();
    await page.waitForURL(/\/bkplus-command$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
}

const confirmDialog = (page) => page.getByRole('alertdialog');

test.describe('Admin console', () => {
    test('a non-admin at the admin door sees the notice, then is taken home', async ({ page }) => {
        await page.goto('/bkplus-command/login');
        await page.getByLabel('Admin email').fill(SEED.provider.email);
        await page.getByLabel('Password').fill(SEED.provider.password);
        await page.getByRole('button', { name: /enter console/i }).click();
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

    test('every tab loads; No-show filter; Business column and guest names', async ({ page, request }) => {
        const fx = await (await request.post(`${API}/__e2e/admin-fixture`)).json();
        await adminLogin(page);

        // The four cards are server-side counts.
        for (const label of ['Users', 'Pending bookings (all)', 'Active services', 'Revenue']) {
            await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
        }

        // Appointments (default tab): Business column, the guest row named and tagged.
        await expect(page.getByRole('columnheader', { name: 'Business' })).toBeVisible();
        const guestRow = page.getByRole('row').filter({ hasText: fx.guestName });
        await expect(guestRow).toBeVisible();
        await expect(guestRow.getByText('Guest', { exact: true })).toBeVisible();
        await expect(guestRow.getByText(fx.businessName)).toBeVisible();

        // No-show filter: only no-shows (it used to return everything).
        await page.getByRole('button', { name: 'No-show', exact: true }).click();
        const noShowRow = page.getByRole('row').filter({ hasText: fx.noShowName });
        await expect(noShowRow).toBeVisible();
        await expect(noShowRow.getByText('Walk-in', { exact: true })).toBeVisible();
        await expect(page.getByRole('row').filter({ hasText: fx.guestName })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^No-show · \d+$/ })).toBeVisible();

        // Each other tab loads.
        await page.getByRole('tab', { name: 'Services' }).click();
        await expect(page.getByRole('button', { name: '+ Add Service' })).toBeVisible();
        await page.getByRole('tab', { name: 'Users' }).click();
        await expect(page.getByLabel('Search users by name or email')).toBeVisible();
        await page.getByRole('tab', { name: 'Revenue' }).click();
        await expect(page.getByText('Total revenue').first()).toBeVisible();
        await page.getByRole('tab', { name: 'Wallet' }).click();
        await expect(page.getByRole('heading', { name: 'Provider top-up requests' })).toBeVisible();

        // Insights uses the same definition of users and names no-shows.
        await page.goto('/bkplus-command/insights');
        await expect(page.getByText('Users = clients + business owners. Team members and admins are counted separately.')).toBeVisible();
        await expect(page.getByText('No-show', { exact: true })).toBeVisible();
    });

    test('suspending a business takes it out of the customer listing; activating brings it back', async ({ page, request }) => {
        const fx = await (await request.post(`${API}/__e2e/admin-fixture`)).json();
        const listed = async () => ((await (await request.get(`${API}/api/providers`)).json()).data || [])
            .some((p) => p._id === fx.providerId);
        expect(await listed()).toBe(true);

        await adminLogin(page);
        await page.getByRole('tab', { name: 'Users' }).click();
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
        await adminLogin(page);
        await page.getByRole('tab', { name: 'Users' }).click();

        const search = page.getByLabel('Search users by name or email');
        await search.fill(ADMIN.email);
        await expect(page.getByRole('row').filter({ hasText: ADMIN.email }).getByText('Your own account: no actions')).toBeVisible();

        await search.fill(SEED.staff.email);
        const staffRow = page.getByRole('row').filter({ hasText: SEED.staff.email });
        await expect(staffRow.getByText(/^Staff · /)).toBeVisible();
        await expect(staffRow.getByRole('button', { name: 'Make Admin' })).toHaveCount(0);

        await search.fill(fx.clientEmail);
        const row = page.getByRole('row').filter({ hasText: fx.clientEmail });
        await row.getByRole('button', { name: 'Make Admin' }).click();
        await confirmDialog(page).getByRole('button', { name: 'Grant access' }).click();
        await expect(row.getByText('Admin', { exact: true })).toBeVisible();
        // Another admin: Remove admin offered, Delete disabled until then.
        await expect(row.getByRole('button', { name: 'Delete' })).toBeDisabled();

        await row.getByRole('button', { name: 'Remove admin' }).click();
        await expect(confirmDialog(page)).toContainText('customer');
        await confirmDialog(page).getByRole('button', { name: 'Remove admin' }).click();
        await expect(row.getByText('Customer', { exact: true })).toBeVisible();
        await expect(row.getByRole('button', { name: 'Make Admin' })).toBeVisible();
    });

    test('credit a business that has no wallet yet', async ({ page, request }) => {
        const fx = await (await request.post(`${API}/__e2e/admin-fixture`)).json();
        await adminLogin(page);
        await page.getByRole('tab', { name: 'Wallet' }).click();
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

    test('on a phone the tab row scrolls, with a fade showing there is more', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await adminLogin(page);
        await expect(page.getByTestId('admin-tabs-fade-right')).toBeVisible();
        await page.getByRole('tab', { name: 'Wallet' }).click();
        await expect(page.getByRole('tab', { name: 'Wallet' })).toBeInViewport();
        await expect(page.getByTestId('admin-tabs-fade-left')).toBeVisible();
    });
});
