const { test, expect } = require('@playwright/test');
const { SEED, login, openCalendarView } = require('./helpers.cjs');

// Staff names appear BOTH as filter chips and inside calendar event labels
// (an event's accessible name includes the member it is assigned to), so an
// inexact name matches two very different controls and Playwright rightly
// refuses to guess. Chips are matched exactly.
const chip = (page, name) => page.getByRole('button', { name, exact: true });

/**
 * Epic 2.4 — per-staff calendar lanes + staff filter.
 * The e2e API seeds a two-person roster (Alex Stylist, Billie Barber) and a
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
        await expect(chip(page, 'Alex Stylist')).toBeVisible();
        await expect(chip(page, 'Billie Barber')).toBeVisible();

        // Unfiltered day view shows the booking with its staff tag
        await expect(page.locator('.fc-event-appt-client', { hasText: 'Walk-in Wanda' })).toBeVisible();
        await expect(page.locator('.fc-event-appt-staff', { hasText: 'Alex Stylist' })).toBeVisible();

        // Filtering to Billie hides Alex's booking; back to All staff restores it
        await chip(page, 'Billie Barber').click();
        await expect(page.locator('.fc-event-appt-client', { hasText: 'Walk-in Wanda' })).toHaveCount(0);
        await chip(page, 'All staff').click();
        await expect(page.locator('.fc-event-appt-client', { hasText: 'Walk-in Wanda' })).toBeVisible();
    });

    test('the Staff view shows one lane per member with bookings in the right lane', async ({ page }) => {
        await openCalendarView(page, 'Staff');

        // One lane per roster member plus the owner's unassigned lane
        const laneHeaders = page.getByTestId('staff-lane-header');
        await expect(laneHeaders.filter({ hasText: SEED.providerName })).toBeVisible();
        await expect(laneHeaders.filter({ hasText: 'Alex Stylist' })).toBeVisible();
        await expect(laneHeaders.filter({ hasText: 'Billie Barber' })).toBeVisible();

        // The seeded booking renders as a lane event and opens its detail modal
        const laneAppt = page.getByTestId('staff-lane-appt').filter({ hasText: 'Walk-in Wanda' });
        await expect(laneAppt).toBeVisible();
        await laneAppt.click();
        await expect(page.getByText('Walk-in Wanda').last()).toBeVisible();
    });

    test('filtering the Staff view narrows it to a single lane', async ({ page }) => {
        await openCalendarView(page, 'Staff');
        await chip(page, 'Alex Stylist').click();

        await expect(page.getByTestId('staff-lane-appt').filter({ hasText: 'Walk-in Wanda' })).toBeVisible();
        await expect(page.getByTestId('staff-lane-header').filter({ hasText: 'Billie Barber' })).toHaveCount(0);
        await expect(page.getByTestId('staff-lane-header').filter({ hasText: 'Alex Stylist' })).toBeVisible();
    });
});
