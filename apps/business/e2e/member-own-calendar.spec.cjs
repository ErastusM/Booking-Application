const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * Every team member runs their OWN calendar — there are no access levels. The
 * seeded staff login, Sam Staff (apps/api/e2e-server.js), is not bookable — so
 * he may block time in his own lane, but is never offered a booking the server
 * would refuse for his closed column.
 */

const cardByName = (page, name) => page.getByTestId('team-member-card').filter({ hasText: name });

test.describe('Every member is the same', () => {
    test("the owner's Team card shows no access level to pick", async ({ page }) => {
        await login(page, SEED.provider);
        await page.goto('/team');

        const card = cardByName(page, SEED.staffName);
        await card.getByRole('button').first().click();
        await card.getByTestId('tab-workspace').click();

        await expect(card.getByTestId('member-tier')).toHaveCount(0);
        await expect(card.getByTestId('member-view-all-clients')).toHaveCount(0);
        for (const word of ['Access level', 'Service provider', 'View only', 'Reception', 'Manager']) {
            await expect(card.getByText(word, { exact: true })).toHaveCount(0);
        }
    });
});

test.describe('A Service provider blocks their own time', () => {
    test('tapping their own calendar offers "Block time" (not a booking their closed column would refuse), and the block lands in their lane', async ({ page }) => {
        await login(page, SEED.staff);
        await expect(page).toHaveURL(/\/dashboard/);
        await expect(page.getByTestId('calendar-view-menu')).toBeVisible();

        // Tap an empty spot in the (only) column of their own calendar.
        const col = page.locator('[data-col-track]').first();
        await col.scrollIntoViewIfNeeded();
        await col.click({ position: { x: 20, y: 200 } });

        const sheet = page.getByRole('dialog').filter({ hasText: "What's this time for?" });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('button', { name: /block time/i })).toBeVisible();
        // Sam's column isn't open for bookings: no "Add appointment" that would 400.
        await expect(sheet.getByRole('button', { name: /add appointment/i })).toHaveCount(0);

        await sheet.getByRole('button', { name: /block time/i }).click();
        // The only lane a Service provider can block: their own.
        await expect(page.getByTestId('block-scope-fixed')).toContainText('Only me (Sam)');
        await page.getByPlaceholder('e.g. Lunch meeting').fill('E2E own block');

        const [created] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/blocked-times') && r.request().method() === 'POST'),
            page.getByRole('button', { name: /^save$/i }).click(),
        ]);
        expect(created.status()).toBe(201);
        const body = await created.json();
        expect(body.data.teamMember).toBeTruthy();
        expect(body.data.ownerOnly).toBe(false);

        // It shows under Blocked Times on their Availability screen — the owner's
        // screen, over their own column.
        await page.goto('/dashboard?tab=availability');
        const screen = page.getByTestId('availability');
        await expect(screen).toBeVisible();
        const row = screen.getByTestId('blocked-time-row').filter({ hasText: 'E2E own block' });
        await expect(row).toBeVisible();

        // …and they can remove it again.
        const [removed] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/blocked-times/') && r.request().method() === 'DELETE'),
            row.getByRole('button', { name: /delete/i }).click(),
        ]);
        expect(removed.status()).toBe(200);
        await expect(screen.getByTestId('blocked-time-row').filter({ hasText: 'E2E own block' })).toHaveCount(0);
    });
});
