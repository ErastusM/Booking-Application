const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers');

test.describe('Customer booking', () => {
    test('customer books the seeded service end to end (no payment)', async ({ page }) => {
        await login(page, SEED.customer);

        // Discovery → provider profile
        await page.goto('/services');
        await page.getByText(SEED.providerName, { exact: false }).first().click();
        await expect(page).toHaveURL(/\/providers\//);

        // Start booking
        await page.getByRole('button', { name: /book now/i }).first().click();
        await expect(page).toHaveURL(/\/book-appointment/);

        // 1) Service
        await page.getByTestId('booking-service').first().click();

        // 2) Date — pick the second day in the strip (avoids any partial "today")
        const dates = page.getByTestId('booking-date');
        await dates.nth(1).click();

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
