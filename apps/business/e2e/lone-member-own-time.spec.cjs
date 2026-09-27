const { test, expect } = require('@playwright/test');
const { login } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;
const pad = (n) => String(n).padStart(2, '0');
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The owner's report, with a screenshot: "The app is following the blocked
 * times of the owner for every member of the business. Moses didn't set blocked
 * times but he's getting the times of the business owner." Their calendar,
 * filtered to Moses (the business's only team member), showed the day the
 * business is closed as fully hatched, and the owner's own blocks on his column.
 *
 * Their decision: a member works only their own hours, and the owner's blocks
 * never apply to a member. The fixture closes the business TODAY, gives Moses
 * 09:00–17:00 of his own, and leaves an old "business-wide" owner block at noon.
 */
test.describe('A lone team member keeps their own time', () => {
    test('filtered to Moses, the calendar shows him bookable on a day the business is closed — and the owner\'s block isn\'t on his column', async ({ page, request }) => {
        const today = localKey(new Date());
        const fx = await (await request.post(`${API}/__e2e/lone-member-fixture`, { data: { date: today } })).json();

        // The server agrees: Moses's day is his own, and the owner's block isn't his.
        const slots = await (await request.get(`${API}/api/appointments/booked-slots`, { params: { providerId: fx.providerId, date: today, teamMember: fx.moses } })).json();
        expect(slots.hoursSource).toBe('weekly');
        expect(slots.memberWindow).toEqual([{ start: '09:00', end: '17:00' }]);
        expect(slots.data.filter((b) => b.kind === 'blocked')).toEqual([]);

        await login(page, { email: fx.email, password: fx.password });
        await page.waitForURL(/\/dashboard/);

        const column = page.locator(`[data-day="${today}"]`);
        await expect(column).toBeVisible();
        const hatch = column.locator('.staff-lane-offhours');

        // The owner's own column (unfiltered = the business's hours): closed all
        // day, and the owner's block shows.
        await expect(hatch).toHaveCount(1);
        await expect(column.getByText('Owner errand')).toBeVisible();

        // Filter to Moses: his own 09:00–17:00 is open (hatch only before and
        // after), and the owner's block is not on his column.
        const hoursLoaded = page.waitForResponse((r) => r.url().includes('/api/team/hours') && r.status() === 200);
        await page.getByRole('button', { name: 'Moses Hamalwa', exact: true }).click();
        await hoursLoaded;
        await expect(hatch).toHaveCount(2);
        await expect(column.getByText('Owner errand')).toHaveCount(0);

        // Back on the owner alone: closed, with their block.
        await page.getByRole('button', { name: 'Moses Hamalwa', exact: true }).click();
        await page.getByRole('button', { name: 'Lone (me)', exact: true }).click();
        await expect(hatch).toHaveCount(1);
        await expect(column.getByText('Owner errand')).toBeVisible();
    });

    test('the owner\'s block form has no "everyone" choice', async ({ page, request }) => {
        const today = localKey(new Date());
        const fx = await (await request.post(`${API}/__e2e/lone-member-fixture`, { data: { date: today } })).json();
        await login(page, { email: fx.email, password: fx.password });
        await page.waitForURL(/\/dashboard/);
        await page.goto('/dashboard?tab=availability');
        await page.getByTestId('add-blocked-time').click();
        const scope = page.getByTestId('block-scope');
        await expect(scope).toBeVisible();
        await scope.click();
        await expect(page.getByRole('option', { name: /whole business|everyone/i })).toHaveCount(0);
        await expect(page.getByRole('option', { name: /Only me/ })).toBeVisible();
        await expect(page.getByRole('option', { name: /Moses Hamalwa/ })).toBeVisible();
    });
});
