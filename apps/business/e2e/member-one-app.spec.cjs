const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * One app: a team member uses the OWNER's app through their own profile.
 * Pat Provider (apps/api/e2e-server.js) is a bookable team member who
 * performs E2E Session at his own price and time (N$120, 45 min) and once served
 * E2E Regular (a completed N$120 booking two days ago).
 */

// The desktop tab row, as the labels read.
const desktopTabs = (page) => page.locator('.nav-desktop').first().locator(':scope > *').allInnerTexts();

test.describe('A team member gets the owner\'s app', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the same navbar as the owner, minus only the owner\'s business-wide items', async ({ page, browser }) => {
        // The owner's row…
        const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const ownerPage = await ownerCtx.newPage();
        await login(ownerPage, SEED.provider);
        await expect(ownerPage.getByTestId('calendar-view-menu')).toBeVisible();
        const ownerTabs = (await desktopTabs(ownerPage)).map((s) => s.trim());
        await ownerCtx.close();

        // …and the member's are the same row, in the same order.
        await login(page, SEED.member);
        await expect(page.getByTestId('calendar-view-menu')).toBeVisible();
        const memberTabs = (await desktopTabs(page)).map((s) => s.trim());
        expect(ownerTabs).toEqual(['Calendar', 'Clients', 'Earnings', 'Catalogue', 'More']);
        expect(memberTabs).toEqual(ownerTabs);

        // "More" keeps the owner's order; business-wide items are simply absent.
        await page.getByRole('button', { name: /^more/i }).click();
        const more = page.getByTestId('more-menu');
        await expect(more.getByRole('link')).toHaveText(['Waiting list', 'Messages']);
        await page.goto('/dashboard'); // the open menu's backdrop covers the bar

        // The avatar menu has the owner's Settings group — their own Availability.
        await page.getByRole('button', { name: 'Account menu' }).click();
        await expect(page.getByRole('link', { name: 'My account' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Availability' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Wallet' })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Team' })).toHaveCount(0);
    });

    test('blocks their own time from the calendar', async ({ page }) => {
        await login(page, SEED.member);
        await expect(page.getByTestId('calendar-view-menu')).toBeVisible();
        const col = page.locator('[data-col-track]').first();
        await col.scrollIntoViewIfNeeded();
        await col.click({ position: { x: 20, y: 200 } });

        const sheet = page.getByRole('dialog').filter({ hasText: "What's this time for?" });
        await expect(sheet).toBeVisible();
        // Pat's column is open for bookings, so both choices are offered.
        await expect(sheet.getByRole('button', { name: /add appointment/i })).toBeVisible();
        await sheet.getByRole('button', { name: /block time/i }).click();
        await expect(page.getByTestId('block-scope-fixed')).toContainText('Only me (Pat)');
        await page.getByPlaceholder('e.g. Lunch meeting').fill('Pat own block');
        const [created] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/blocked-times') && r.request().method() === 'POST'),
            page.getByRole('button', { name: /^save$/i }).click(),
        ]);
        expect(created.status()).toBe(201);
        const body = await created.json();
        expect(body.data.teamMember).toBeTruthy();
        expect(body.data.ownerOnly).toBe(false);

        // It is listed under Blocked Times on their Availability screen.
        await page.goto('/dashboard?tab=availability');
        await expect(page.getByTestId('blocked-time-row').filter({ hasText: 'Pat own block' })).toBeVisible();
    });

    test('edits their own service in the owner\'s sheet, with the Duration picker', async ({ page }) => {
        await login(page, SEED.member);
        await page.goto('/dashboard?tab=services');
        const menu = page.getByTestId('service-menu');
        const row = menu.getByTestId('catalogue-service').filter({ hasText: SEED.serviceName });
        await expect(row).toContainText('45 min');
        await expect(row).toContainText('120');

        await row.getByRole('button', { name: 'Edit' }).click();
        await expect(page.getByRole('heading', { name: 'Edit service' })).toBeVisible();
        // The owner's Duration picker, not a "Minutes" box.
        const duration = page.getByTestId('service-duration');
        await expect(duration).toContainText('45 min');
        await duration.click();
        await page.getByTestId('service-duration-popup').locator('[data-value="75"]').click();
        const [saved] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/team/mine/pricing') && r.request().method() === 'PUT'),
            page.getByRole('button', { name: 'Save changes' }).click(),
        ]);
        expect(saved.ok()).toBeTruthy();
        await expect(menu.getByTestId('catalogue-service').filter({ hasText: SEED.serviceName })).toContainText('1 hr 15 min');

        // Put it back to 45 min so the booking below reads as seeded.
        await menu.getByTestId('catalogue-service').filter({ hasText: SEED.serviceName }).getByRole('button', { name: 'Edit' }).click();
        await page.getByTestId('service-duration').click();
        await page.getByTestId('service-duration-popup').locator('[data-value="45"]').click();
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/team/mine/pricing') && r.request().method() === 'PUT'),
            page.getByRole('button', { name: 'Save changes' }).click(),
        ]);
    });

    test('sets their hours, then books an existing client of theirs', async ({ page }) => {
        await login(page, SEED.member);
        // Their Availability is the owner's Working Hours screen over their own hours.
        await page.goto('/dashboard?tab=availability');
        for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
            await page.getByRole('button', { name: `Toggle ${day}` }).click();
        }
        const [hours] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/team/mine/availability') && r.request().method() === 'PUT'),
            page.getByTestId('save-hours').click(),
        ]);
        expect(hours.ok()).toBeTruthy();

        // The owner's New Appointment screen, with "+ Add service", Group booking and Repeat.
        await page.goto('/dashboard?new=1');
        const modal = page.locator('form').filter({ has: page.getByTestId('appt-service-0') });
        await expect(modal).toBeVisible();
        await expect(modal.getByRole('button', { name: '+ Add service' })).toBeVisible();
        await expect(modal.getByText('Group booking')).toBeVisible();

        await page.getByTestId('appt-service-0').click();
        await page.getByTestId('appt-service-0-popup').getByRole('option', { name: new RegExp(SEED.serviceName) }).click();
        // The client list: search, then pick the row (radio-style listbox).
        await page.getByTestId('appt-client-search').fill(SEED.regularName);
        await page.getByTestId('appt-client-list').getByRole('option', { name: new RegExp(SEED.regularName) }).click();
        await expect(page.getByTestId('appt-client-list').getByRole('option', { name: new RegExp(SEED.regularName) })).toHaveAttribute('aria-selected', 'true');

        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        if (tomorrow.getMonth() !== new Date().getMonth()) await modal.getByRole('button', { name: 'Next month' }).click();
        await modal.getByRole('button', { name: String(tomorrow.getDate()), exact: true }).click();
        await modal.getByRole('button', { name: '10:00', exact: true }).click();

        const [booked] = await Promise.all([
            page.waitForResponse((r) => /\/api\/appointments$/.test(r.url()) && r.request().method() === 'POST'),
            modal.getByRole('button', { name: 'Book Appointment' }).click(),
        ]);
        expect(booked.status()).toBe(201);
        const appt = (await booked.json()).data;
        expect(appt.customer?.name || '').toBe(SEED.regularName);
        // His own price and time for the service.
        expect(appt.totalPrice).toBe(120);
        expect(appt.endTime).toBe('10:45');
    });

    test('sees their own earnings on the owner\'s Earnings screen', async ({ page }) => {
        await login(page, SEED.member);
        await page.getByRole('link', { name: 'Earnings' }).first().click();
        await expect(page).toHaveURL(/tab=earnings/);
        await expect(page.getByRole('heading', { name: 'Earnings', exact: true })).toBeVisible();
        const allTime = page.locator('div').filter({ has: page.getByText('All-time earned', { exact: true }) }).last();
        await expect(allTime).toContainText('120');
        await expect(page.getByRole('cell', { name: SEED.regularName })).toBeVisible();
        // One person's report: never a breakdown of colleagues.
        await expect(page.getByText('Earnings by staff member')).toHaveCount(0);
    });
});
