const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

// The owner's report, on the real booking page: a 2-hour service must only be
// offered at a start where the WHOLE two hours fit the professional — never at
// 14:00 when 15:00 is booked — and a booking that ends exactly when the next
// starts is fine. The fixture business (e2e-server /__e2e/overlap-fixture) has
// a 2-hour Braids; Tino has a booking 15:00–16:00 that day; Selma works only
// 13:00–16:00 (the screenshot: 15:00 can't START a 2-hour service, though
// nothing is booked there).

const API = `http://localhost:${process.env.E2E_API_PORT || 5052}`;

// The first day of next month, in the browser's (= this runner's) calendar —
// the day the page's "Next month" view offers first.
const firstOfNextMonth = () => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

const pill = (page, time) => page.getByRole('group', { name: /pick a time/i }).getByRole('button').filter({ hasText: new RegExp(`^${time}`) });

const openDay = async (page, fixture, who) => {
    await page.goto(`/book-appointment?providerId=${fixture.providerId}`);
    await page.getByTestId('booking-staff').filter({ hasText: who }).click();
    await page.getByTestId('booking-service').filter({ hasText: 'Braids' }).click();
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.locator('[data-testid="booking-date"]:not([disabled])').first().click();
    await expect(page.getByText(/pick a time/i).first()).toBeVisible();
};

test.describe('A 2-hour service only starts where the whole 2 hours fit', () => {
    let fixture;
    const date = firstOfNextMonth();

    test.beforeAll(async ({ request }) => {
        const res = await request.post(`${API}/__e2e/overlap-fixture`, { data: { date } });
        expect(res.ok()).toBeTruthy();
        fixture = await res.json();
    });

    test('15:00 is booked: 14:00 is not offered (and the server refuses it); 13:00 books, ending as 15:00 starts', async ({ page, request }) => {
        await login(page, SEED.customer);
        await openDay(page, fixture, 'Tino');

        await expect(pill(page, '13:00')).toHaveAttribute('data-testid', 'booking-time');
        await expect(pill(page, '14:00')).toHaveAttribute('data-testid', 'booking-time-booked');
        await expect(pill(page, '14:00')).toContainText(/taken/i);
        await expect(pill(page, '15:00')).toHaveAttribute('data-testid', 'booking-time-booked');
        await expect(pill(page, '16:00')).toHaveAttribute('data-testid', 'booking-time');

        // Whatever a client sends, the server is the last line of defence.
        const auth = await request.post(`${API}/api/auth/login`, { data: { ...SEED.customer, accountType: 'customer' } });
        const token = (await auth.json()).data.token;
        const direct = await request.post(`${API}/api/appointments`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { service: fixture.serviceId, teamMember: fixture.tino, appointmentDate: date, startTime: '14:00', endTime: '16:00' },
        });
        expect(direct.status()).toBe(409);

        // 13:00–15:00 touches the 15:00 booking — that is not an overlap.
        await pill(page, '13:00').click();
        await page.getByTestId('booking-continue').click();
        await page.getByTestId('booking-confirm').click();
        await expect(page).toHaveURL(/\/appointments\?confirmed=1/);
        await expect(page.getByText('Braids', { exact: false }).first()).toBeVisible();
    });

    test("the screenshot: Selma's day ends at 16:00 — 14:00 is free, 15:00 says why it can't start", async ({ page }) => {
        await login(page, SEED.customer);
        await openDay(page, fixture, 'Selma');

        await expect(pill(page, '13:00')).toHaveAttribute('data-testid', 'booking-time');
        await expect(pill(page, '14:00')).toHaveAttribute('data-testid', 'booking-time');
        // Not "occupied": a 2-hour service simply doesn't fit before 16:00.
        await expect(pill(page, '15:00')).toContainText('Not enough time before 16:00');
        await expect(pill(page, '15:00')).toBeDisabled();
        await expect(pill(page, '12:00')).toContainText('Unavailable');
    });
});
