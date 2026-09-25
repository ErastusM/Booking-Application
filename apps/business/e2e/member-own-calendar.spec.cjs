const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * A team member nobody chose an access level for runs their OWN calendar
 * ("Service provider"). The seeded staff login, Sam Staff (apps/api/e2e-server.js),
 * has no stored tier and is not bookable — so he may block time in his own lane,
 * but is never offered a booking the server would refuse for his closed column.
 */

const cardByName = (page, name) => page.getByTestId('team-member-card').filter({ hasText: name });

test.describe('Access level — Service provider is the default', () => {
    test('the owner sees a member with no level chosen as "Service provider", listed first', async ({ page }) => {
        await login(page, SEED.provider);
        await page.goto('/team');

        const card = cardByName(page, SEED.staffName);
        await card.getByRole('button').first().click();
        await card.getByTestId('tab-workspace').click();

        const picker = card.getByTestId('member-tier');
        // The app's own Select: the value is on data-value, options open in a popup.
        await expect(picker).toHaveAttribute('data-value', 'low');
        await expect(picker).toContainText('Service provider');
        await picker.click();
        const options = page.getByTestId('member-tier-popup').getByRole('option');
        await expect(options.first()).toContainText('Service provider');
        await expect(page.getByTestId('member-tier-popup').locator('[data-value="basic"]')).toContainText('View only');
        await page.keyboard.press('Escape');
        await expect(card).toContainText('blocks their own time');
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

        // It shows under their own "Blocked time" on the Hours screen, where the
        // owner keeps "Blocked Times".
        await page.goto('/dashboard?tab=availability');
        const blocks = page.getByTestId('member-blocks');
        await expect(blocks).toBeVisible();
        await expect(blocks.getByTestId('member-block').filter({ hasText: 'E2E own block' })).toBeVisible();

        // …and they can remove it again.
        const [removed] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/blocked-times/') && r.request().method() === 'DELETE'),
            blocks.getByTestId('member-block').filter({ hasText: 'E2E own block' }).getByRole('button', { name: /unblock/i }).click(),
        ]);
        expect(removed.status()).toBe(200);
        await expect(blocks.getByTestId('member-block').filter({ hasText: 'E2E own block' })).toHaveCount(0);
    });
});
