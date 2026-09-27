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
 * same page without the dressing-up must get none of it. The bars that take the
 * nav's place (a provider's "Book now", the booking flow's Continue) move the
 * same way, and the colour they carry on below themselves adds no scroll.
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
        // The fix itself on an iPhone: the document at least screen-high.
        htmlMinH: getComputedStyle(html).minHeight,
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

// A bar that takes the nav's place at the bottom edge, and the colour it
// carries on below itself. scrollHNoUnder is the page with that paint-under
// switched off, so the two show it adds no scroll.
const measureBar = (sel) => {
    const html = document.documentElement;
    const bar = document.querySelector(sel);
    const under = getComputedStyle(bar, '::after');
    const out = {
        bottomCss: getComputedStyle(bar).bottom,
        bottom: bar.getBoundingClientRect().bottom,
        barBg: getComputedStyle(bar).backgroundColor,
        underBg: under.backgroundColor,
        underH: under.height,
        innerH: window.innerHeight,
        innerW: window.innerWidth,
        scrollH: html.scrollHeight,
        scrollW: html.scrollWidth,
    };
    const off = document.createElement('style');
    off.textContent = `${sel}::after { display: none !important; }`;
    document.head.appendChild(off);
    out.scrollHNoUnder = html.scrollHeight;
    off.remove();
    return out;
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
        expect(plain.htmlMinH).toBe('0px');
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
        expect(app.htmlMinH).toBe(`${PHONE.viewport.height + GAP}px`);
        expect(app.navBottomCss).toBe(`-${GAP}px`);
        expect(Math.round(app.navBottom)).toBe(app.innerH + GAP);
        expect(app.scrollW).toBeLessThanOrEqual(app.innerW);
        expect(app.scrollH - app.innerH).toBeLessThanOrEqual(GAP);
        // The page still fills down to the nav: it grew by exactly the gap.
        expect(Math.round(app.mainH - plain.mainH)).toBe(GAP);
    });

    test('the bars that replace the nav (profile "Book now", booking "Continue"): unchanged in a browser, on the real edge in the app', async ({ page }) => {
        await login(page, SEED.customer);
        await page.goto('/');
        await page.getByRole('button', { name: `View ${SEED.providerName}` }).first().click();
        await expect(page).toHaveURL(/\/providers\//);
        const profileUrl = page.url();

        // Pick a professional and a service so the booking page's Continue bar shows.
        const pickService = async () => {
            await page.getByTestId('booking-staff').first().click();
            await page.getByTestId('booking-service').first().click();
            await expect(page.locator('.booking-mobile-bar')).toBeVisible();
            await settle(page);
        };

        // A plain phone browser: the bars sit on the viewport's edge, and the
        // colour they carry on below themselves is off-screen and adds no scroll.
        const expectPlain = (plain) => {
            expect(plain.bottomCss).toBe('0px');
            expect(Math.round(plain.bottom)).toBe(plain.innerH);
            expect(plain.underBg).toBe(plain.barBg);
            expect(plain.underH).toBe('120px');
            expect(plain.scrollH).toBe(plain.scrollHNoUnder);
            expect(plain.scrollW).toBeLessThanOrEqual(plain.innerW);
        };
        await expect(page.locator('.provider-book-bar')).toBeVisible();
        await settle(page);
        expectPlain(await page.evaluate(measureBar, '.provider-book-bar'));
        await page.locator('.provider-book-bar').getByRole('button', { name: /book now/i }).click();
        await expect(page).toHaveURL(/\/book-appointment/);
        const bookingUrl = page.url();
        await pickService();
        expectPlain(await page.evaluate(measureBar, '.booking-mobile-bar'));

        // The installed iPhone app with the short viewport: both drop by the gap.
        await stubHomeScreenApp(page);
        await page.goto(profileUrl);
        await expect(page.locator('.provider-book-bar')).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--vp-gap'))).toBe(`${GAP}px`);
        await settle(page);
        const profile = await page.evaluate(measureBar, '.provider-book-bar');
        expect(profile.bottomCss).toBe(`-${GAP}px`);
        expect(Math.round(profile.bottom)).toBe(profile.innerH + GAP);
        expect(profile.scrollW).toBeLessThanOrEqual(profile.innerW);
        // (Chromium's window never grows, so the dropped bar's button is below
        // it and can't be tapped here; on the phone that is the screen's bottom.)
        await page.goto(bookingUrl);
        await pickService();
        const booking = await page.evaluate(measureBar, '.booking-mobile-bar');
        expect(booking.bottomCss).toBe(`-${GAP}px`);
        expect(Math.round(booking.bottom)).toBe(booking.innerH + GAP);
        expect(booking.scrollW).toBeLessThanOrEqual(booking.innerW);
    });
});
