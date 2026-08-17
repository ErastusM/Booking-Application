// Shared helpers + seeded credentials for the business-app E2E specs.
// Accounts are created by apps/api/e2e-server.js on boot.
const { expect } = require('@playwright/test');

const SEED = {
    customer: { email: 'e2e-customer@bookplus.dev', password: 'Password1!' },
    provider: { email: 'e2e-provider@bookplus.dev', password: 'Password1!' },
    // A seeded staff login (roster member 'Sam Staff') for the self-service specs.
    staff: { email: 'e2e-staff@bookplus.dev', password: 'Password1!' },
    staffName: 'Sam Staff',
    serviceName: 'E2E Haircut',
    providerName: 'E2E Provider',
    // The dashboard addresses the owner by first name only.
    providerFirstName: 'E2E',
};

const CUSTOMER_URL = `http://localhost:${process.env.E2E_CUSTOMER_PORT || 3104}`;

// Log in on whichever app `page` is currently pointed at (same form markup).
async function login(page, { email, password }, origin = '') {
    await page.goto(`${origin}/login`);
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
}

/**
 * Assert the page is showing the signed-in provider's own dashboard.
 *
 * Two specs used to assert a heading matching /^Good (morning|afternoon|
 * evening), E2E/. No such greeting has ever existed in apps/business — the
 * specs were written against a dashboard that was never built, so they could
 * only ever fail. Landing on /dashboard is not on its own worth asserting
 * either: an unauthenticated visit is bounced to /login, so the URL alone says
 * little about WHO is signed in.
 *
 * What genuinely proves it is the calendar's own-column chip, which is built
 * from the authenticated user's name (`user.name.split(' ')[0] + ' (me)'`).
 * If the session were wrong or missing, that chip could not read "E2E (me)".
 */
async function expectProviderDashboard(page, { timeout = 15_000 } = {}) {
    await expect(page).toHaveURL(/\/dashboard/, { timeout });
    // The calendar is the default tab; its staff filter is the owner-scoped strip.
    await expect(page.getByRole('group', { name: /filter calendar by staff member/i }))
        .toBeVisible({ timeout });
    await expect(page.getByRole('button', { name: `${SEED.providerFirstName} (me)`, exact: true }))
        .toBeVisible({ timeout });
}

/**
 * Switch the calendar to a named view (Day / 3 Day / Week / Staff).
 *
 * These used to be four side-by-side buttons; the view switcher is now a
 * single dropdown in the calendar header, so `getByRole('button', {name:
 * 'Staff'})` waited forever for a control that only exists once the menu is
 * open. The trigger is found by test id rather than by name, because its name
 * IS the current view and therefore changes as the test drives it.
 */
async function openCalendarView(page, label) {
    await page.getByTestId('calendar-view-menu').click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
}

module.exports = { SEED, login, CUSTOMER_URL, expectProviderDashboard, openCalendarView };
