const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * Page spacing guard: on a phone, every screen's first content starts just under
 * the top bar — no empty band above it. Sign-in, sign-up and the other
 * single-card pages are the exception (the owner's call): their card sits in the
 * middle of the screen under the bar, and a short one doesn't scroll.
 *
 * The bands this guards against: pages adding the status-bar inset that <main>
 * already pads (sign-up), which only shows in the installed iPhone app, and
 * 100dvh pages inside <main> that always scrolled. A plain browser has no inset,
 * so the phone runs twice: as a browser, and with an iPhone's safe-area insets
 * emulated. The rule itself is index.css --page-hero-pad-top (56px + 1.1rem on
 * phones) and, for the card pages, .auth-right / .auth-page.
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

// Where the card sits in the room it has: between the bottom of the top bar (or
// of the status-bar inset <main> pads, with no bar) and the bottom of the screen,
// less the body's room for the bottom nav. The card is `sel`, or else everything
// laid out inside <main>. offset > 0: below the middle.
const measureCentring = (sel) => {
    const main = document.getElementById('main-content');
    const bar = document.querySelector('nav[aria-label="Main"]');
    const mr = main.getBoundingClientRect();
    const top = Math.max(bar ? bar.getBoundingClientRect().bottom : 0, mr.top + parseFloat(getComputedStyle(main).paddingTop));
    const bottom = window.innerHeight - parseFloat(getComputedStyle(document.body).paddingBottom);
    let r;
    if (sel) r = document.querySelector(sel).getBoundingClientRect();
    else {
        const pageBg = getComputedStyle(document.body).backgroundColor;
        const hidden = (el) => {
            for (let a = el; a && a !== main.parentElement; a = a.parentElement) {
                const cs = getComputedStyle(a);
                if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
            }
            return false;
        };
        r = { top: Infinity, bottom: -Infinity };
        const add = (b) => { if (b.width >= 2 && b.height >= 2) { r.top = Math.min(r.top, b.top); r.bottom = Math.max(r.bottom, b.bottom); } };
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
        const range = document.createRange();
        for (let n; (n = walker.nextNode());) {
            if (!n.parentElement || n.parentElement.closest('style,script') || hidden(n.parentElement)) continue;
            range.selectNodeContents(n);
            for (const b of range.getClientRects()) add(b);
        }
        for (const el of main.querySelectorAll('*')) {
            const cs = getComputedStyle(el);
            const painted = /^(img|svg|input|select|textarea|button|canvas|video)$/i.test(el.tagName)
                || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== pageBg)
                || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0;
            if (painted && !hidden(el)) add(el.getBoundingClientRect());
        }
    }
    return {
        offset: Math.round((r.top + r.bottom) / 2 - (top + bottom) / 2),
        above: Math.round(r.top - top),
        below: Math.round(bottom - r.bottom),
        tall: r.bottom - r.top > bottom - top,
        // <main> running past the screen = the page scrolls (sign-in and sign-up
        // have the footer after it, on purpose).
        scroll: Math.round(mr.bottom - bottom),
    };
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

async function expectCardCentred(page, path, sel) {
    await page.goto(path);
    await settle(page);
    const m = await page.evaluate(measureCentring, sel || null);
    const where = `${path}: card ${m.above}px under the bar, ${m.below}px above the bottom`;
    if (m.tall) {
        // Taller than the screen (business sign-up): starts under the bar, scrolls.
        expect(m.above, where).toBeGreaterThanOrEqual(0);
        expect(m.above, where).toBeLessThanOrEqual(MAX_GAP);
        return;
    }
    expect(Math.abs(m.offset), `${where} (${m.offset}px off centre)`).toBeLessThanOrEqual(MAX_GAP);
    expect(m.scroll, `${path}: page scrolls by ${m.scroll}px`).toBeLessThanOrEqual(1);
}

const SIGNED_OUT_SCREENS = ['/manage/not-a-token', '/terms'];
const CUSTOMER_SCREENS = ['/appointments', '/waiting-list', '/profile'];
// [path, the card (default: everything in <main>)]. Sign-up's progress dots sit
// above its card, so there the card alone is centred below them.
const AUTH_SCREENS = [
    ['/login'],
    ['/register', '[data-testid="register-step"] > *'],
    ['/forgot-password'],
    ['/reset-password?token=nope'],
    ['/verify-email?token=nope'],
    ['/unsubscribe/nope.nope'],
];
const SIGNED_IN_AUTH_SCREENS = [['/complete-profile'], ['/become-provider']];

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

        test('sign-in and password pages sit in the middle of the screen', async ({ page }) => {
            for (const [path, sel] of AUTH_SCREENS) await expectCardCentred(page, path, sel);
        });

        test('signed-in single-card pages sit in the middle of the screen', async ({ page }) => {
            await login(page, SEED.customer);
            for (const [path, sel] of SIGNED_IN_AUTH_SCREENS) await expectCardCentred(page, path, sel);
        });
    });
}
