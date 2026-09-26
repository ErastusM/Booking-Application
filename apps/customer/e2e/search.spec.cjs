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

// The hero's date field is the app-styled DatePicker (@bookplus/ui), not a native
// <input type="date">: open it and tap the day. The grid opens on the current
// month, so step to the next one when tomorrow falls across a month boundary.
const pickDate = async (page, key) => {
    await page.getByTestId('search-date').click();
    const popup = page.getByTestId('search-date-popup');
    await expect(popup).toBeVisible();
    const day = popup.locator(`[data-key="${key}"]`);
    if (!(await day.count())) await popup.getByRole('button', { name: 'Next month' }).click();
    await day.click();
    await expect(page.getByTestId('search-date')).toHaveAttribute('data-value', key);
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

        await pickDate(page, tomorrow());

        // Still listed: the seeded provider works 08:00–18:00, so tomorrow has openings.
        await expect(page.getByText(SEED.providerName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

        // And removing the date returns to the unfiltered feed. Cleared via the field
        // itself (its × clear control), deliberately: the "Clear filters" button only
        // renders inside the zero-results empty state, so it does not exist while
        // results are showing.
        await page.getByTestId('search-date-clear').click();
        await expect(page.getByTestId('search-date')).toHaveAttribute('data-value', '');
        await expect(page.getByText(SEED.providerName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    });

    test('a time floor past closing removes that provider', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText(SEED.providerName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

        await pickDate(page, tomorrow());
        // 19:00 is past the seeded provider's 18:00 close, so there is nothing left
        // to book and they must drop out of the feed.
        await page.getByTestId('search-time').click();
        await page.getByTestId('search-time-popup').getByRole('option', { name: '19:00' }).click();
        await expect(page.getByTestId('search-time')).toHaveAttribute('data-value', '19:00');

        await expect(page.getByText(SEED.providerName, { exact: false })).toHaveCount(0, { timeout: 15_000 });
    });
});
