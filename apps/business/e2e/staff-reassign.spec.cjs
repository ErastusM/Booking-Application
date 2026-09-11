const { test, expect } = require('@playwright/test');
const { SEED, login, openCalendarView } = require('./helpers.cjs');

const chip = (page, name) => page.getByRole('button', { name, exact: true });

/**
 * Calendar polish 2b — dragging a booking SIDEWAYS in the Staff (per-staff
 * lanes) view reassigns it to that lane's team member (a change of performer),
 * routed to the single provider-reschedule endpoint with a teamMember.
 *
 * The seed books "Walk-in Wanda" on Alex on today AND tomorrow. This drives
 * TOMORROW's copy so the card is never "elapsed" (finished bookings lock and
 * can't be dragged), keeping the test independent of the wall-clock time the
 * run happens to start at.
 *
 * Press-and-hold: the drag hook lifts a card only after a ~330ms hold, so the
 * gesture is mousedown → wait past the hold → move → up, mirroring a real
 * long-press. A mouse mousedown fires pointerdown too, which is what the hook
 * listens on.
 */
test.describe('Staff lanes — drag to reassign', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, SEED.provider);
        await page.waitForURL(/\/dashboard/);
        await openCalendarView(page, 'Staff');
        // Move to tomorrow, where Wanda is seeded but never in the past.
        await page.getByRole('button', { name: 'Next day' }).click();
    });

    test('dragging a booking into another lane reassigns its performer', async ({ page }) => {
        const wanda = page.getByTestId('staff-lane-appt').filter({ hasText: 'Walk-in Wanda' });
        await expect(wanda).toBeVisible();

        const card = await wanda.boundingBox();
        const billieHeader = page.getByTestId('staff-lane-header').filter({ hasText: 'Billie Barber' });
        const billie = await billieHeader.boundingBox();

        const startX = card.x + card.width / 2;
        const startY = card.y + card.height / 2;
        const targetX = billie.x + billie.width / 2; // Billie's lane sits under its header

        // Press-and-hold, then carry it sideways into Billie's lane at the same
        // height (same time), and let go.
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.waitForTimeout(450);            // exceed the 330ms hold
        await page.mouse.move(startX, startY + 1, { steps: 2 }); // arm + measure the lane width
        await page.mouse.move(targetX, startY, { steps: 16 });
        await page.waitForTimeout(60);
        await page.mouse.up();

        // Nothing is written until the reassign is confirmed.
        const sheet = page.getByRole('dialog', { name: 'Reassign this booking?' });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByText('Billie Barber')).toBeVisible();
        await sheet.getByRole('button', { name: /Move to/ }).click();
        await expect(sheet).toBeHidden();

        // The booking now lives in Billie's lane, not Alex's.
        await chip(page, 'Billie Barber').click();
        await expect(page.getByTestId('staff-lane-appt').filter({ hasText: 'Walk-in Wanda' })).toBeVisible();
        await chip(page, 'Alex Stylist').click();
        await expect(page.getByTestId('staff-lane-appt').filter({ hasText: 'Walk-in Wanda' })).toHaveCount(0);
    });
});
