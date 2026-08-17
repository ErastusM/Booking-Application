const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * The three Team changes shipped in PR #120:
 *   1. the staff working-hours editor labels its Start / End columns,
 *   2. "Send invite" reports truthfully whether the email went out and flips the
 *      member to "invited, awaiting login" (the e2e API has SMTP disabled, so the
 *      honest result here is the "didn't send" branch — the account is still made),
 *   3. a staff member manages their OWN services from My schedule.
 */

// A member card is a collapsible; its header is the first button inside it.
const cardByName = (page, name) => page.getByTestId('team-member-card').filter({ hasText: name });
const expandCard = async (card) => card.getByRole('button').first().click();

test.describe('Team — working hours labels', () => {
    test('the custom-hours editor labels the starting and ending time columns', async ({ page }) => {
        await login(page, SEED.provider);
        await page.goto('/team');

        const card = cardByName(page, 'Alex Stylist');
        await expandCard(card);
        await card.getByTestId('tab-workspace').click();

        // Hours inherit the business by default — reveal the per-day editor.
        await card.getByTestId('custom-hours').click();

        await expect(card.getByText('Starting time', { exact: true })).toBeVisible();
        await expect(card.getByText('Ending time', { exact: true })).toBeVisible();
    });
});

test.describe('Team — invite to log in', () => {
    test('sending an invite reports the result and marks the member as invited', async ({ page }) => {
        await login(page, SEED.provider);
        await page.goto('/team');

        // A fresh member so the invite is deterministic and isolated from the
        // seeded roster (unique name survives a CI retry against the same server).
        const name = `E2E Invitee ${Date.now()}`;
        await page.getByTestId('new-member-name').fill(name);
        await page.getByTestId('new-member-add').click();

        const card = cardByName(page, name);
        await expect(card).toBeVisible();
        await expandCard(card);
        await card.getByTestId('tab-workspace').click();

        const email = 'invitee@example.com';
        await card.getByTestId('invite-email').fill(email);
        await card.getByTestId('invite-send').click();

        // Truthful confirmation, naming the address. SMTP is off in e2e, so this
        // is the "didn't send" branch — but it still names the address and proves
        // the send was attempted and reported rather than silently swallowed.
        const result = card.getByTestId('invite-result');
        await expect(result).toBeVisible();
        await expect(result).toContainText(email);

        // The account was created, so the member now reads as invited-not-yet-active.
        await expect(card).toContainText('invited, awaiting login');
    });
});

test.describe('My schedule — staff choose their own services', () => {
    test('a staff member selects a service and it persists across a reload', async ({ page }) => {
        await login(page, SEED.staff);
        await expect(page).toHaveURL(/\/my-schedule/);

        const services = page.getByTestId('my-services');
        await expect(services).toBeVisible();
        // Sam performs everything to begin with (no explicit selection).
        await expect(services).toContainText('You perform every service.');

        const chip = services.getByTestId('my-service-chip').filter({ hasText: SEED.serviceName });
        // Wait on the actual save so the reload below can't race ahead of it.
        const [saved] = await Promise.all([
            page.waitForResponse(r => r.url().includes('/team/mine/services') && r.request().method() === 'PUT'),
            chip.click(),
        ]);
        expect(saved.ok()).toBeTruthy();
        await expect(services).toContainText('You perform 1 of 1 service.');

        // Survives a reload — it was actually persisted, not just local state.
        await page.reload();
        const after = page.getByTestId('my-services');
        await expect(after).toContainText('You perform 1 of 1 service.');
    });
});
