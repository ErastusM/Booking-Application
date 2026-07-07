const { test, expect } = require('@playwright/test');

// Local YYYY-MM-DD for tomorrow — the seeded provider works 08:00–18:00 every
// day, so tomorrow always has openings from 08:00 (today would flake after 18:00).
const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

test.describe('Availability-first search (desktop)', () => {
    test('searching a date shows real openings and the filter clears', async ({ page }) => {
        await page.goto('/');

        await page.getByLabel('Date').fill(tomorrow());
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.waitForURL(/\/services\?.*date=/);

        // Availability-first results: count says "available" and the provider
        // card carries opening chips. Earlier specs in this run may have booked
        // the morning slots (shared in-memory DB), so assert the chip SHAPE,
        // not a specific clock time.
        await expect(page.getByText(/business(es)? available/)).toBeVisible();
        await expect(page.getByText(/^\d{2}:\d{2}$/).first()).toBeVisible();

        // The dismissible date chip clears back to the plain directory.
        await page.locator('button[title="Clear the availability filter"]').click();
        await expect(page.getByText(/business(es)? found/)).toBeVisible();
    });

    test('a time floor trims earlier openings', async ({ page }) => {
        await page.goto(`/services?date=${tomorrow()}&time=15:00`);
        await expect(page.getByText(/business(es)? available/)).toBeVisible();
        await expect(page.getByText('15:00', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('08:00', { exact: true })).toHaveCount(0);
    });
});
