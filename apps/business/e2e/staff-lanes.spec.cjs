const { test, expect } = require('@playwright/test');
const { SEED, login, openCalendarView } = require('./helpers.cjs');

// Staff names appear BOTH as filter chips and inside calendar event labels
// (an event's accessible name includes the member it is assigned to), so an
// inexact name matches two very different controls and Playwright rightly
// refuses to guess. Chips are matched exactly.
const chip = (page, name) => page.getByRole('button', { name, exact: true });

/**
 * Epic 2.4 — per-staff calendar lanes + staff filter.
 * The e2e API seeds a two-person roster (Alex Rivera, Billie Chen) and a
 * confirmed walk-in booked on Alex today at 10:00, so the dashboard calendar
 * has real multi-staff content to assert against.
 */
test.describe('Per-staff calendar lanes', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, SEED.provider);
        await page.waitForURL(/\/dashboard/);
    });

    test('staff filter chips render and the day view tags events with their staff member', async ({ page }) => {
        // Filter chips appear once the roster loads
        await expect(chip(page, 'All staff')).toBeVisible();
        await expect(chip(page, 'Alex Rivera')).toBeVisible();
        await expect(chip(page, 'Billie Chen')).toBeVisible();

        // Unfiltered, the booking shows with its staff tag. The default view is
        // 3-Day and the walk-in is seeded on today AND tomorrow (so a run
        // straddling midnight can't lose it), so BOTH render — assert the first,
        // not a strict single match.
        await expect(page.locator('.fc-event-appt-client', { hasText: 'Guest Wanda' }).first()).toBeVisible();
        await expect(page.locator('.fc-event-appt-staff', { hasText: 'Alex Rivera' }).first()).toBeVisible();

        // Filtering to Billie hides Alex's booking (every copy); back to All staff restores it.
        await chip(page, 'Billie Chen').click();
        await expect(page.locator('.fc-event-appt-client', { hasText: 'Guest Wanda' })).toHaveCount(0);
        await chip(page, 'All staff').click();
        await expect(page.locator('.fc-event-appt-client', { hasText: 'Guest Wanda' }).first()).toBeVisible();
    });

    test('the Staff view shows one lane per member with bookings in the right lane', async ({ page }) => {
        await openCalendarView(page, 'Staff');

        // One lane per roster member plus the owner's unassigned lane
        const laneHeaders = page.getByTestId('staff-lane-header');
        await expect(laneHeaders.filter({ hasText: SEED.providerName })).toBeVisible();
        await expect(laneHeaders.filter({ hasText: 'Alex Rivera' })).toBeVisible();
        await expect(laneHeaders.filter({ hasText: 'Billie Chen' })).toBeVisible();

        // The seeded booking renders as a lane event and opens its detail modal
        const laneAppt = page.getByTestId('staff-lane-appt').filter({ hasText: 'Guest Wanda' });
        await expect(laneAppt).toBeVisible();
        await laneAppt.click();
        await expect(page.getByText('Guest Wanda').last()).toBeVisible();
    });

    // The owner's answer: each member's lane is shaded by their OWN hours. The
    // seed gives Billie 08:00–18:00 and Alex none of his own, so Alex's whole
    // lane is closed and says why, while Billie's is open in her hours.
    test('each lane is shaded by that person\'s own hours', async ({ page }) => {
        await openCalendarView(page, 'Staff');
        const laneHeaders = page.getByTestId('staff-lane-header');
        await expect(laneHeaders.filter({ hasText: 'Alex Rivera' })).toContainText('No working hours');
        await expect(laneHeaders.filter({ hasText: 'Billie Chen' })).not.toContainText('No working hours');
        // Alex's lane: one band, top to bottom. Billie's: only outside 08:00–18:00.
        const alexLane = page.locator('[data-lane-id]').nth(await laneHeaders.evaluateAll((els) => els.findIndex((e) => e.textContent.includes('Alex Rivera'))));
        const bands = alexLane.getByTestId('staff-lane-off');
        await expect(bands).toHaveCount(1);
        const laneBox = await alexLane.boundingBox();
        const bandBox = await bands.first().boundingBox();
        expect(Math.round(bandBox.height)).toBe(Math.round(laneBox.height));
    });

    test('filtering the Staff view narrows it to a single lane', async ({ page }) => {
        await openCalendarView(page, 'Staff');
        await chip(page, 'Alex Rivera').click();

        await expect(page.getByTestId('staff-lane-appt').filter({ hasText: 'Guest Wanda' })).toBeVisible();
        await expect(page.getByTestId('staff-lane-header').filter({ hasText: 'Billie Chen' })).toHaveCount(0);
        await expect(page.getByTestId('staff-lane-header').filter({ hasText: 'Alex Rivera' })).toBeVisible();
    });
});
