const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

test.describe('Customer booking', () => {
    test('customer books the seeded service end to end (no payment)', async ({ page }) => {
        await login(page, SEED.customer);

        // Discovery → provider profile. '/' is the discovery feed now; this used to
        // say '/services' and only still worked because that path redirects here.
        await page.goto('/');
        await page.getByText(SEED.providerName, { exact: false }).first().click();
        await expect(page).toHaveURL(/\/providers\//);

        // Start booking
        await page.getByRole('button', { name: /book now/i }).first().click();
        await expect(page).toHaveURL(/\/book-appointment/);

        // 1) Professional first (person-first flow) — the seeded business has a
        //    roster, so a named member must be chosen before their services show.
        await page.getByTestId('booking-staff').first().click();

        // 2) Service (now filtered to that professional, at their price)
        await page.getByTestId('booking-service').first().click();

        // 3) Date — advance one month and take the first selectable day. The
        //    provider works every day, so the next month's day 1 is always a full
        //    seeded 08:00–18:00 (never today, whose slots may be in the past; never
        //    in the past). Picking within the current month broke on a month
        //    boundary — e.g. on the 31st, "tomorrow" lives in the next month view
        //    and the current view has only today enabled, so nth(1) never appeared.
        await page.getByRole('button', { name: 'Next month' }).click();
        await page.locator('[data-testid="booking-date"]:not([disabled])').first().click();

        // 3) Time — first available (non-booked) slot
        await page.getByTestId('booking-time').first().click();

        // 4) Continue → Review → Confirm
        await page.getByTestId('booking-continue').click();
        await expect(page.getByRole('button', { name: /^confirm$/i }).first()).toBeVisible();
        await page.getByTestId('booking-confirm').click();

        // Lands on My Appointments with the confirmation flag
        await expect(page).toHaveURL(/\/appointments\?confirmed=1/);
        await expect(page.getByText(SEED.serviceName, { exact: false }).first()).toBeVisible();
    });

    test('customer can cancel an upcoming appointment', async ({ page }) => {
        await login(page, SEED.customer);
        await page.goto('/appointments');

        const cancelBtn = page.getByRole('button', { name: /^cancel$/i }).first();
        if (await cancelBtn.count()) {
            page.once('dialog', (d) => d.accept()); // confirm() prompt
            await cancelBtn.click();
            await expect(page.getByText(/cancelled/i).first()).toBeVisible({ timeout: 10_000 });
        }
    });
});
