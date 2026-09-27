const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * iPhone home-screen app: the bottom nav stays on the real bottom edge.
 *
 * In the installed iPhone app iOS gives a page that is no taller than the
 * screen a viewport short by the status-bar inset (~59pt), which lifted the
 * bottom nav that far off the bottom of the screen. Since #241 the short pages
 * (waiting list, bookings…) fit the screen exactly, so they are the ones it
 * hits. The @bookplus/ui helper (standaloneViewport) makes such a document
 * screen-high and, if the viewport stays short anyway, drops the bottom nav by
 * the missing height (--vp-gap) and lets the full-screen pages follow it.
 *
 * iOS can't run here. This Chromium is dressed up as that phone instead:
 * navigator.standalone (iOS-only) and a screen 59px taller than the window.
 * Chromium's window never grows to fit, so it is the fallback that shows. The
 * same page without the dressing-up must get none of it.
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

const measure = () => {
    const html = document.documentElement;
    const nav = document.querySelector('nav[aria-label="Bottom navigation"]');
    const main = document.getElementById('main-content');
    return {
        fixClass: html.classList.contains('ios-vp-fix'),
        appFullH: html.style.getPropertyValue('--app-full-h'),
        vpGap: html.style.getPropertyValue('--vp-gap'),
        navBottomCss: nav ? getComputedStyle(nav).bottom : null,
        navBottom: nav ? nav.getBoundingClientRect().bottom : null,
        mainH: main ? main.getBoundingClientRect().height : null,
        innerH: window.innerHeight,
        innerW: window.innerWidth,
        scrollH: html.scrollHeight,
        scrollW: html.scrollWidth,
    };
};

test.describe('iPhone home-screen app — bottom nav on the real bottom edge', () => {
    test.use(PHONE);

    test('a short page: nothing changes in a browser; in the app the nav and the page follow the real edge', async ({ page }) => {
        await login(page, SEED.customer);

        // A plain phone browser: none of it applies, the layout is #241's.
        await page.goto('/waiting-list');
        await expect(page.getByRole('navigation', { name: 'Bottom navigation' })).toBeVisible();
        await settle(page);
        const plain = await page.evaluate(measure);
        expect(plain.fixClass).toBe(false);
        expect(plain.appFullH).toBe('');
        expect(plain.vpGap).toBe('');
        expect(plain.navBottomCss).toBe('0px');
        expect(Math.round(plain.navBottom)).toBe(plain.innerH);
        expect(plain.scrollH - plain.innerH).toBeLessThanOrEqual(0);
        expect(plain.scrollW).toBeLessThanOrEqual(plain.innerW);

        // The installed iPhone app with the short viewport.
        await stubHomeScreenApp(page);
        await page.goto('/waiting-list');
        await expect(page.getByRole('navigation', { name: 'Bottom navigation' })).toBeAttached();
        await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--vp-gap'))).toBe(`${GAP}px`);
        await settle(page);
        const app = await page.evaluate(measure);
        expect(app.fixClass).toBe(true);
        expect(app.appFullH).toBe(`${PHONE.viewport.height + GAP}px`);
        expect(app.navBottomCss).toBe(`-${GAP}px`);
        expect(Math.round(app.navBottom)).toBe(app.innerH + GAP);
        expect(app.scrollW).toBeLessThanOrEqual(app.innerW);
        expect(app.scrollH - app.innerH).toBeLessThanOrEqual(GAP);
        // The page still fills down to the nav: it grew by exactly the gap.
        expect(Math.round(app.mainH - plain.mainH)).toBe(GAP);
    });
});
