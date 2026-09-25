const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * The three Team changes shipped in PR #120:
 *   1. the staff working-hours editor labels its Start / End columns,
 *   2. "Send invite" reports truthfully whether the email went out and flips the
 *      member to "invited, awaiting login" (the e2e API has SMTP disabled, so the
 *      honest result here is the "didn't send" branch — the account is still made),
 *   3. a staff member lands on the calendar and manages their OWN services
 *      from the Services screen.
 */

// A member card is a collapsible; its header is the first button inside it.
const cardByName = (page, name) => page.getByTestId('team-member-card').filter({ hasText: name });
const expandCard = async (card) => card.getByRole('button').first().click();

test.describe('Team — working hours labels', () => {
    test('the custom-hours editor labels the starting and ending time columns', async ({ page }) => {
        await login(page, SEED.provider);
        await page.goto('/team');

        const card = cardByName(page, 'Alex Rivera');
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
        // Job title and email are mandatory on a member; the Add button stays
        // disabled until all three are filled.
        await page.getByTestId('new-member-role').fill('Specialist');
        await page.getByTestId('new-member-email').fill(`invitee-${Date.now()}@example.com`);
        await page.getByTestId('new-member-add').click();

        // The add must visibly CONFIRM — an auto-dismissing toast, not just a row
        // that may scroll out of view on a long roster.
        await expect(page.getByText(`${name} added to your team.`)).toBeVisible();

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

test.describe('A team member manages their own services', () => {
    test('adds a service at their own price from the Services screen, and it persists', async ({ page }) => {
        await login(page, SEED.staff);
        // A team member's home is the same calendar the owner uses (their own bookings).
        await expect(page).toHaveURL(/\/dashboard/);
        await expect(page.getByTestId('calendar-view-menu')).toBeVisible();

        // Their Services screen is the owner's "Service menu" layout, scoped to them.
        await page.goto('/dashboard?tab=services');
        const services = page.getByTestId('member-services');
        await expect(services).toBeVisible();

        await services.getByTestId('member-add-service').click();
        await page.getByTestId('member-service-name').fill('Beard oil');
        await page.getByTestId('member-service-price').fill('80');
        await page.getByTestId('member-service-duration').fill('20');
        const [priced] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/team/mine/pricing') && r.request().method() === 'PUT'),
            page.getByTestId('member-service-save').click(),
        ]);
        expect(priced.ok()).toBeTruthy();
        const card = services.getByTestId('member-service').filter({ hasText: 'Beard oil' });
        await expect(card).toContainText('80');
        await expect(card).toContainText('20 min');

        // Survives a reload — it was saved, not just local state.
        await page.reload();
        await expect(page.getByTestId('member-service').filter({ hasText: 'Beard oil' })).toContainText('80');
    });
});
