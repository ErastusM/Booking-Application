const { test, expect } = require('@playwright/test');
const { login } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;

/**
 * The owner's decision: "Just give them something like this. This is what the
 * owners have right? 'Availability'". A team member gets the owner's Working
 * Hours screen over their own week; the owner sees the same screen on the
 * member's Team page. A member's change applies at once and the owner gets an
 * in-app notification. The old per-date "Shifts" and "Time off" blocks are gone.
 * Checked on a 390px phone.
 */
test.use({ viewport: { width: 390, height: 844 } });

const noSideScroll = async (page) => {
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
};

test.describe('Working Hours — the same screen for a member and the owner', () => {
    test('a member sets Saturday on, the owner is told, and sees the same week on Team', async ({ page, browser, request }) => {
        const fx = await (await request.post(`${API}/__e2e/member-hours-fixture`)).json();

        // ── The member: Availability is the Working Hours screen over their week.
        await login(page, { email: fx.member, password: fx.password });
        await page.goto('/dashboard?tab=availability');
        await expect(page.getByRole('heading', { name: 'Working Hours' })).toBeVisible();
        await expect(page.getByText('Set the days and hours clients can book you.')).toBeVisible();
        await expect(page.getByRole('switch', { name: 'Open on monday' })).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByRole('switch', { name: 'Open on saturday' })).toHaveAttribute('aria-checked', 'false');
        // No time-off requests on this screen any more.
        await expect(page.getByText('Time off', { exact: true })).toHaveCount(0);
        await expect(page.getByTestId('request-time-off')).toHaveCount(0);
        await expect(page.getByTestId('save-hours')).toBeVisible();
        await noSideScroll(page);

        await page.getByRole('switch', { name: 'Open on saturday' }).click();
        const [saved] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/team/mine/availability') && r.request().method() === 'PUT'),
            page.getByTestId('save-hours').click(),
        ]);
        expect(saved.ok()).toBeTruthy();
        await expect(page.getByRole('status').filter({ hasText: 'Your hours are saved' })).toBeVisible();

        // ── The owner: an in-app notification, then the same screen on Team.
        const ownerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const owner = await ownerCtx.newPage();
        await login(owner, { email: fx.owner, password: fx.password });
        await owner.getByRole('button', { name: 'Notifications' }).first().click();
        await expect(owner.getByText('Moses changed their working hours: Saturday 09:00 – 17:00.')).toBeVisible();

        await owner.goto('/team');
        const card = owner.getByTestId('team-member-card').filter({ hasText: 'Moses Hamalwa' });
        await card.getByRole('button').first().click();
        await card.getByTestId('tab-workspace').click();
        const editor = card.getByTestId('member-working-hours');
        await expect(editor.getByRole('heading', { name: 'Moses’s working hours' })).toBeVisible();
        await expect(editor.getByRole('switch', { name: 'Open on saturday' })).toHaveAttribute('aria-checked', 'true');
        await expect(editor.getByRole('switch', { name: 'Open on sunday' })).toHaveAttribute('aria-checked', 'false');
        await expect(editor.getByRole('combobox', { name: 'Saturday opening time' })).toHaveText(/09:00/);
        // The old per-date blocks are gone.
        await expect(card.getByText('Shifts', { exact: true })).toHaveCount(0);
        await expect(card.getByText('Time off', { exact: true })).toHaveCount(0);
        await expect(card.getByTestId('shift-date')).toHaveCount(0);
        await expect(card.getByTestId('timeoff-from')).toHaveCount(0);
        await noSideScroll(owner);

        // The owner turns Sunday on for him — saved at once.
        await editor.getByRole('switch', { name: 'Open on sunday' }).click();
        const [ownerSave] = await Promise.all([
            owner.waitForResponse((r) => r.url().includes(`/team/${fx.moses}/availability`) && r.request().method() === 'PUT'),
            editor.getByTestId('save-hours').click(),
        ]);
        expect(ownerSave.ok()).toBeTruthy();
        await expect(editor.getByRole('status')).toContainText('Moses’s hours are saved');
        await ownerCtx.close();

        // The member sees it on their own screen.
        await page.reload();
        await expect(page.getByRole('switch', { name: 'Open on sunday' })).toHaveAttribute('aria-checked', 'true');
    });
});
