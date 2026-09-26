const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * Page spacing guard: on a phone, every screen's first content starts just under
 * the top bar — no empty band above it.
 *
 * The bands this guards against: single-card pages (sign-in, forgot/reset
 * password, unsubscribe, verify email…) centred in a full-height column, so the
 * card floated mid-screen under up to ~260px of empty background; and pages
 * adding the status-bar inset that <main> already pads (sign-up), which only
 * shows in the installed iPhone app. A plain browser has no inset, so the phone
 * runs twice: as a browser, and with an iPhone's safe-area insets emulated.
 * The rule itself is index.css --page-hero-pad-top (56px + 1.1rem on phones).
 */
const MAX_GAP = 24;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const IPHONE_INSETS = { top: 47, bottom: 34, left: 0, right: 0 };

// Distance from the bottom of the top bar to the first laid-out content inside
// <main>: text, controls, and boxes with their own background, border or shadow.
// Fixed layers (bottom nav, overlays, the calendar frame) don't count; hidden
// (visibility / opacity 0) ones don't either, so a box that only reserves space
// shows up as a gap.
const measureTopGap = () => {
    const main = document.getElementById('main-content');
    const bar = document.querySelector('nav[aria-label="Main"]');
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const pageBg = getComputedStyle(document.body).backgroundColor;
    const hidden = (el) => {
        for (let a = el; a && a !== main.parentElement; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
        }
        return false;
    };
    let top = Infinity; let what = '';
    // A box that runs up under the bar (a dark page header) starts at the bar.
    const consider = (r, el) => {
        if (r.width < 2 || r.height < 2 || r.bottom <= barBottom + 1) return;
        const t = Math.max(r.top, barBottom);
        if (t < top) { top = t; what = `${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40)}"`; }
    };
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    const range = document.createRange();
    for (let n; (n = walker.nextNode());) {
        const el = n.parentElement;
        if (!el || el.closest('style,script') || hidden(el)) continue;
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) consider(r, el);
    }
    for (const el of main.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        const painted = /^(img|svg|input|select|textarea|button|canvas|video)$/i.test(el.tagName)
            || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== pageBg)
            || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0;
        if (painted && !hidden(el)) consider(el.getBoundingClientRect(), el);
    }
    return { barBottom: Math.round(barBottom), gap: Math.round(top - barBottom), what };
};

// Let the page load and its entrance animations (fade-ins) finish; a spinner's
// endless animation is ignored.
async function settle(page) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForFunction(() => document.getAnimations().every((a) => {
        const t = a.effect && a.effect.getTiming && a.effect.getTiming();
        return a.playState !== 'running' || (t && t.iterations === Infinity);
    }), null, { timeout: 5_000 }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
}

async function expectContentUnderBar(page, path) {
    await page.goto(path);
    await settle(page);
    const m = await page.evaluate(measureTopGap);
    expect(m.gap, `${path}: first content (${m.what}) starts ${m.gap}px below the top bar`).toBeLessThanOrEqual(MAX_GAP);
}

const SIGNED_OUT_SCREENS = [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password?token=nope',
    '/verify-email?token=nope',
    '/unsubscribe/nope.nope',
    '/manage/not-a-token',
    '/terms',
];
const CUSTOMER_SCREENS = ['/appointments', '/waiting-list', '/profile', '/wallet', '/complete-profile'];

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

        test('signed-out screens start just under the top bar', async ({ page }) => {
            for (const path of SIGNED_OUT_SCREENS) await expectContentUnderBar(page, path);
        });

        test('signed-in screens start just under the top bar', async ({ page }) => {
            await login(page, SEED.customer);
            for (const path of CUSTOMER_SCREENS) await expectContentUnderBar(page, path);
        });
    });
}
