const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * iPhone home-screen app: the bottom nav stays on the real bottom edge.
 *
 * On the owner's installed iPhone app the Clients and Calendar tabs showed the
 * bottom nav ~59pt (the status-bar inset) above the bottom of the screen, over
 * an empty grey strip. iOS gives a page that is no taller than the screen a
 * viewport short by that inset; since #241 those tabs fit the screen exactly.
 * The @bookplus/ui helper (standaloneViewport) makes such a document screen-high
 * and, if the viewport stays short anyway, drops the bottom nav by the missing
 * height (--vp-gap) and lets the full-screen fills follow it.
 *
 * iOS can't run here. This Chromium is dressed up as that phone instead:
 * navigator.standalone (iOS-only) and a screen 59px taller than the window.
 * Chromium's window never grows to fit, so it is the fallback that shows: the
 * nav sits 59px below the window's bottom edge, where the phone's real bottom
 * edge would be. The same page without the dressing-up must get none of it.
 */
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const GAP = 59;

const stubHomeScreenApp = (page) => page.addInitScript(({ w, h }) => {
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
    Object.defineProperty(Screen.prototype, 'width', { configurable: true, get: () => w });
    Object.defineProperty(Screen.prototype, 'height', { configurable: true, get: () => h });
}, { w: PHONE.viewport.width, h: PHONE.viewport.height + GAP });

async function settle(page) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForFunction(() => document.getAnimations().every((a) => {
        const t = a.effect && a.effect.getTiming && a.effect.getTiming();
        return a.playState !== 'running' || (t && t.iterations === Infinity);
    }), null, { timeout: 5_000 }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
}

// Everything the fix touches, measured in the page.
const measure = () => {
    const html = document.documentElement;
    const nav = document.querySelector('nav[aria-label="Bottom navigation"]');
    const bar = nav && nav.firstElementChild;
    const bottomOf = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().bottom : null; };
    const under = bar ? getComputedStyle(bar, '::after') : null;
    return {
        fixClass: html.classList.contains('ios-vp-fix'),
        appFullH: html.style.getPropertyValue('--app-full-h'),
        vpGap: html.style.getPropertyValue('--vp-gap'),
        navBottomCss: nav ? getComputedStyle(nav).bottom : null,
        navBottom: nav ? nav.getBoundingClientRect().bottom : null,
        barTop: bar ? bar.getBoundingClientRect().top : null,
        barBg: bar ? getComputedStyle(bar).backgroundColor : null,
        underBg: under ? under.backgroundColor : null,
        underH: under ? under.height : null,
        listBottom: bottomOf('[data-testid="clients"] .cp-body'),
        calBottom: bottomOf('.cal-frame'),
        innerH: window.innerHeight,
        innerW: window.innerWidth,
        scrollH: html.scrollHeight,
        scrollW: html.scrollWidth,
    };
};

test.describe('iPhone home-screen app — bottom nav on the real bottom edge', () => {
    test.use(PHONE);

    test('Clients and Calendar: nothing changes in a browser; in the app the nav and the fills follow the real edge', async ({ page }) => {
        await login(page, SEED.provider);

        // A plain phone browser: none of it applies, the layout is #241's.
        await page.goto('/dashboard?tab=clients');
        await expect(page.getByTestId('clients-list')).toBeVisible();
        await settle(page);
        const plain = await page.evaluate(measure);
        expect(plain.fixClass).toBe(false);
        expect(plain.appFullH).toBe('');
        expect(plain.vpGap).toBe('');
        expect(plain.navBottomCss).toBe('0px');
        expect(Math.round(plain.navBottom)).toBe(plain.innerH);
        // The page fits the screen exactly: nothing to scroll either way.
        expect(plain.scrollH - plain.innerH).toBeLessThanOrEqual(0);
        expect(plain.scrollW).toBeLessThanOrEqual(plain.innerW);
        // The bar's colour runs on below it, off-screen here (and adds no scroll: above).
        expect(plain.underBg).toBe(plain.barBg);
        expect(plain.underH).toBe('120px');
        expect(plain.listBottom).toBeLessThanOrEqual(plain.barTop);

        await page.goto('/dashboard');
        await expect(page.locator('.fc-bookplus-wrapper')).toBeVisible();
        await settle(page);
        const plainCal = await page.evaluate(measure);
        expect(plainCal.fixClass).toBe(false);
        expect(plainCal.scrollH - plainCal.innerH).toBeLessThanOrEqual(0);

        // The installed iPhone app with the short viewport.
        await stubHomeScreenApp(page);
        await page.goto('/dashboard?tab=clients');
        await expect(page.getByTestId('clients-list')).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--vp-gap'))).toBe(`${GAP}px`);
        await settle(page);
        const app = await page.evaluate(measure);
        expect(app.fixClass).toBe(true);
        expect(app.appFullH).toBe(`${PHONE.viewport.height + GAP}px`);
        expect(app.navBottomCss).toBe(`-${GAP}px`);
        expect(Math.round(app.navBottom)).toBe(app.innerH + GAP);
        expect(app.scrollW).toBeLessThanOrEqual(app.innerW);
        expect(app.scrollH - app.innerH).toBeLessThanOrEqual(GAP);
        // The client list still ends just above the bar, the same distance as in
        // the browser — it ran on down with the nav instead of stopping 59px short.
        expect(Math.abs((app.barTop - app.listBottom) - (plain.barTop - plain.listBottom))).toBeLessThanOrEqual(1);

        await page.goto('/dashboard');
        await expect(page.locator('.fc-bookplus-wrapper')).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--vp-gap'))).toBe(`${GAP}px`);
        await settle(page);
        const appCal = await page.evaluate(measure);
        expect(appCal.fixClass).toBe(true);
        expect(appCal.navBottomCss).toBe(`-${GAP}px`);
        // The calendar frame drops with the nav: same place above it as in a browser.
        expect(Math.round(appCal.calBottom - plainCal.calBottom)).toBe(GAP);
        expect(Math.round(appCal.barTop - appCal.calBottom)).toBe(Math.round(plainCal.barTop - plainCal.calBottom));
        expect(appCal.scrollW).toBeLessThanOrEqual(appCal.innerW);
        expect(appCal.scrollH - appCal.innerH).toBeLessThanOrEqual(GAP);
    });
});
