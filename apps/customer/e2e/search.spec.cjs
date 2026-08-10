const { test, expect } = require('@playwright/test');
const { SEED } = require('./helpers.cjs');

// Local YYYY-MM-DD for tomorrow — the seeded provider works 08:00–18:00 every
// day, so tomorrow always has openings (today would flake after 18:00).
const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// These specs used to drive a separate /services results page with opening-time
// chips. That page was folded into the home feed: search now filters in place
// (Home.jsx — "the results ARE the home now"), and availability is used to narrow
// the feed rather than to print chips on cards. Rewritten against that UI.
//
// The pair below is deliberate: a date alone must KEEP a provider who has
// openings, and a late time floor must REMOVE the same provider. Asserting only
// the first would pass even if the availability filter did nothing at all.
test.describe('Availability filtering on the home feed', () => {
    test('a date keeps a provider who has openings that day', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText(SEED.providerName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

        await page.getByLabel('Date').fill(tomorrow());

        // Still listed: the seeded provider works 08:00–18:00, so tomorrow has openings.
        await expect(page.getByText(SEED.providerName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

        // And the filter can be cleared again.
        await page.getByRole('button', { name: /clear filters/i }).first().click();
        await expect(page.getByLabel('Date')).toHaveValue('');
    });

    test('a time floor past closing removes that provider', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText(SEED.providerName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

        await page.getByLabel('Date').fill(tomorrow());
        // 19:00 is past the seeded provider's 18:00 close, so there is nothing left
        // to book and they must drop out of the feed.
        await page.getByLabel('Time').selectOption('19:00');

        await expect(page.getByText(SEED.providerName, { exact: false })).toHaveCount(0, { timeout: 15_000 });
    });
});
