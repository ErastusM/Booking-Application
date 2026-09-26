const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * The Clients tab is the same contact-style list as New Appointment's client
 * step (components/ClientPicker, browse mode): search, A–Z sections and rail,
 * each client's completed visits, last visit and total spend; tapping a client
 * opens their detail. The owner's past clients (Amara … Zacharias) are seeded by
 * apps/api/e2e-server.js, plus E2E Regular and the walk-in Guest Wanda.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Day-month as the list writes it (the year only when it isn't this year).
const dayMonth = (d, now = new Date()) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
const daysAgo = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };

test.describe('Clients tab — the contact-style list', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the owner searches, jumps with the A–Z rail and opens a client', async ({ page }) => {
        await login(page, SEED.provider);
        await page.goto('/dashboard?tab=clients');

        await expect(page.getByRole('heading', { name: 'My Clients' })).toBeVisible();
        const list = page.getByRole('list', { name: 'Clients' });
        await expect(list).toBeVisible();
        // Every client is in the list (it renders only the rows near the screen,
        // so the count is the rows' set size). Other specs may add clients.
        await expect(page.getByTestId('clients-total')).toHaveText(/^\d+ total$/);
        const total = Number((await page.getByTestId('clients-total').textContent()).split(' ')[0]);
        expect(total).toBeGreaterThanOrEqual(11);
        await expect(list.getByRole('listitem').first()).toHaveAttribute('aria-setsize', String(total));

        // Rows are buttons (no radio), with visits, last visit and spend.
        const hilma = page.getByTestId('clients-list').getByRole('button', { name: /Hilma Shikongo/ });
        await expect(hilma).toContainText('+264811000003');
        await expect(hilma).toContainText(`2 visits · last visit ${dayMonth(daysAgo(29))}`);
        await expect(hilma).toContainText('N$ 300');
        await expect(page.getByTestId('clients-list').locator('.cp-radio')).toHaveCount(0);
        await expect(page.getByTestId('clients-list').getByRole('button', { name: /Guest Wanda/ })).toContainText('Walk-in');

        // Phone-first: the list fills the tab down to the bottom nav and scrolls
        // inside itself; the rail sits clear of the nav and its "+".
        const body = await page.locator('[data-testid="clients"] .cp-body').boundingBox();
        const rail = await page.getByTestId('clients-rail').boundingBox();
        const nav = await page.getByRole('navigation', { name: 'Bottom navigation' }).locator(':scope > div').boundingBox();
        const plus = await page.getByRole('link', { name: 'New booking' }).locator('span').first().boundingBox();
        expect(body.height).toBeGreaterThan(300);
        expect(rail.y + rail.height).toBeLessThanOrEqual(nav.y);
        expect(rail.y + rail.height).toBeLessThanOrEqual(plus.y);
        expect(await page.getByTestId('clients-list').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

        // Search: name, then phone digits.
        const search = page.getByTestId('clients-search');
        await search.fill('nghid');
        await expect(list.getByRole('button')).toHaveCount(1);
        await expect(list.getByRole('button')).toContainText('Martha Nghidinwa');
        await search.fill('811000005');
        await expect(list.getByRole('button')).toHaveCount(1);
        await expect(list.getByRole('button')).toContainText('Martha Nghidinwa');
        await page.getByTestId('clients-clear').tap();
        await expect(list.getByRole('listitem').first()).toHaveAttribute('aria-setsize', String(total));

        // The rail: "M" scrolls the list to Martha.
        const martha = list.getByRole('button', { name: /Martha Nghidinwa/ });
        await page.getByTestId('clients-letter-M').tap();
        await expect(page.getByTestId('clients').getByRole('status')).toHaveText('M');
        expect(await page.getByTestId('clients-list').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        const listBox = await page.getByTestId('clients-list').boundingBox();
        const mBox = await martha.boundingBox();
        expect(mBox.y).toBeGreaterThanOrEqual(listBox.y);
        expect(mBox.y + mBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);
        await expect(martha).toContainText(`1 visit · last visit ${dayMonth(daysAgo(35))}`);
        await expect(martha).toContainText('N$ 250');

        // Tapping the client opens the client detail (full width on a phone).
        await martha.tap();
        const detail = page.locator('.client-detail-panel');
        await expect(detail.getByRole('heading', { name: 'Martha Nghidinwa' })).toBeVisible();
        await expect(detail).toContainText('Visit History (1)');
        await expect(detail).toContainText('+264811000005');
        await expect(page.getByTestId('clients-list')).toBeHidden();

        // Closing it brings the list back where it was.
        await detail.getByRole('button', { name: 'Close' }).tap();
        await expect(martha).toBeVisible();
        expect(await page.getByTestId('clients-list').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    });
});
