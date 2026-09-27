const { test, expect } = require('@playwright/test');
const { SEED, login, measureTopGap, settle } = require('./helpers.cjs');

/**
 * Page spacing guard: on a phone, every screen's first content starts just under
 * the top bar — no empty band above it.
 *
 * The band this guards against: <main> pads the status-bar inset, and the
 * dashboard container added env(safe-area-inset-top) again, so the installed
 * iPhone app showed an empty grey band the height of the inset (58pt) above the
 * Clients list and every other tab. A plain browser has no inset, so the phone
 * runs twice: as a browser, and with an iPhone's safe-area insets emulated.
 * The rule itself is index.css "Page spacing" (--page-pad-top: 56px + 12px).
 * measureTopGap / settle live in helpers.cjs (the Services tab spec uses them too).
 */
const MAX_GAP = 24;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const IPHONE_INSETS = { top: 47, bottom: 34, left: 0, right: 0 };

async function expectContentUnderBar(page, path) {
    await page.goto(path);
    await settle(page);
    const m = await page.evaluate(measureTopGap);
    expect(m.gap, `${path}: first content (${m.what}) starts ${m.gap}px below the top bar`).toBeLessThanOrEqual(MAX_GAP);
}

const OWNER_SCREENS = [
    '/dashboard?tab=clients',
    '/dashboard?tab=earnings',
    '/dashboard?tab=services',
    '/dashboard?tab=waitlist',
    '/dashboard?tab=messages',
    '/account?section=settings',
    '/team',
];
const SIGNED_OUT_SCREENS = ['/login', '/forgot-password', '/terms'];

for (const variant of ['browser', 'iPhone app (safe-area insets)']) {
    test.describe(`Page spacing on a 390x844 phone — ${variant}`, () => {
        test.use(PHONE);

        test.beforeEach(async ({ page }) => {
            if (variant === 'browser') return;
            try {
                const cdp = await page.context().newCDPSession(page);
                await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: IPHONE_INSETS });
            } catch (e) {
                test.skip(true, `this Chromium can't emulate safe-area insets (${e.message.split('\n')[0]})`);
            }
        });

        test('owner screens start just under the top bar', async ({ page }) => {
            await login(page, SEED.provider);
            for (const path of OWNER_SCREENS) await expectContentUnderBar(page, path);
        });

        test('signed-out screens start just under the top bar', async ({ page }) => {
            for (const path of SIGNED_OUT_SCREENS) await expectContentUnderBar(page, path);
        });
    });
}

// The "Finish setting up" nudge and the push banner sit above every tab but the
// calendar (whose full-screen frame would hide them). They are hidden there, not
// unmounted: unmounted, every switch away from the calendar refetched
// /providers/me/setup-status and the nudge landed ~400ms late, pushing the list
// the owner was about to tap down by 177px.
test.describe('Dashboard banners on a phone', () => {
    test.use(PHONE);

    test('switching tabs neither refetches the setup nudge nor lets the calendar page scroll', async ({ page }) => {
        let setupStatusCalls = 0;
        page.on('request', (req) => { if (req.url().includes('/providers/me/setup-status')) setupStatusCalls += 1; });
        await login(page, SEED.provider);
        await page.goto('/dashboard');
        await expect(page.getByRole('group', { name: /filter calendar by staff member/i })).toBeVisible();
        await settle(page);
        const afterLanding = setupStatusCalls;
        // The calendar is a fixed frame: the page under it has nothing to scroll.
        expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);

        const bottomNav = page.getByRole('navigation', { name: 'Bottom navigation' });
        for (const tab of ['Clients', 'Calendar', 'Earnings', 'Calendar', 'Clients']) {
            await bottomNav.getByRole('link', { name: tab, exact: true }).click();
            await settle(page);
        }
        expect(setupStatusCalls, 'setup-status requests caused by switching tabs').toBe(afterLanding);
    });
});

// >= 1024px there is no bottom nav, so the calendar frame runs to the bottom
// edge — but on an iPad in the installed app the grid must still stop above the
// home indicator (20px), as it did when the frame sat above the bottom nav.
test.describe('Calendar frame on a wide screen', () => {
    for (const { name, viewport, insets } of [
        { name: 'iPad landscape, installed app', viewport: { width: 1180, height: 820 }, insets: { top: 24, bottom: 20, left: 0, right: 0 } },
        { name: 'desktop browser', viewport: { width: 1280, height: 800 }, insets: null },
    ]) {
        test(`${name}: the grid ends at the bottom edge, clear of the home indicator`, async ({ page }) => {
            await page.setViewportSize(viewport);
            if (insets) {
                try {
                    const cdp = await page.context().newCDPSession(page);
                    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
                } catch (e) {
                    test.skip(true, `this Chromium can't emulate safe-area insets (${e.message.split('\n')[0]})`);
                }
            }
            await login(page, SEED.provider);
            await page.goto('/dashboard');
            const grid = page.locator('.fc-bookplus-wrapper');
            await expect(grid).toBeVisible();
            const bottom = await grid.evaluate((el) => el.getBoundingClientRect().bottom);
            // Flush with the edge above the inset: no hidden strip, no empty strip.
            expect(Math.round(bottom)).toBe(viewport.height - (insets ? insets.bottom : 0));
        });
    }
});
