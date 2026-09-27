const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

// The owner's report: "Moses didn't set blocked times but he's getting the
// times of the business owner." Their decision: a team member is booked on
// THEIR OWN hours only, even on a day the business (the owner) is closed, and
// the owner's blocks never apply to them. The fixture business
// (e2e-server /__e2e/lone-member-fixture) is closed on the chosen day's weekday;
// Moses, its only team member, works 09:00–17:00 every day; the owner has an
// old "business-wide" block 12:00–13:00 that day.

const API = `http://localhost:${process.env.E2E_API_PORT || 5052}`;

const firstOfNextMonth = () => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

const pill = (page, time) => page.getByRole('group', { name: /pick a time/i }).getByRole('button').filter({ hasText: new RegExp(`^${time}`) });

test('a lone member works a day the business is closed: the day is open for him and his own hours are offered', async ({ page }) => {
    const date = firstOfNextMonth();
    const res = await page.request.post(`${API}/__e2e/lone-member-fixture`, { data: { date } });
    expect(res.ok()).toBeTruthy();
    const fixture = await res.json();

    await login(page, SEED.customer);
    await page.goto(`/book-appointment?providerId=${fixture.providerId}`);
    await page.getByTestId('booking-staff').filter({ hasText: 'Moses' }).click();
    await page.getByTestId('booking-service').filter({ hasText: 'Cut' }).click();
    await page.getByRole('button', { name: 'Next month' }).click();

    // The 1st — a day the business is closed — is open for Moses.
    const first = page.getByTestId('booking-date').first();
    await expect(first).toBeEnabled();
    await first.click();
    await expect(page.getByText(/pick a time/i).first()).toBeVisible();

    // His own 09:00–17:00: 09:00 is offered; the owner's noon block doesn't touch him.
    await expect(pill(page, '09:00')).toHaveAttribute('data-testid', 'booking-time');
    await expect(pill(page, '12:00')).toHaveAttribute('data-testid', 'booking-time');
    await expect(pill(page, '16:00')).toHaveAttribute('data-testid', 'booking-time');

    await pill(page, '12:00').click();
    await page.getByTestId('booking-continue').click();
    await page.getByTestId('booking-confirm').click();
    await expect(page).toHaveURL(/\/appointments\?confirmed=1/);
});
