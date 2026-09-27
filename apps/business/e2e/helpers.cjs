// Shared helpers + seeded credentials for the business-app E2E specs.
// Accounts are created by apps/api/e2e-server.js on boot.
const { expect } = require('@playwright/test');

const SEED = {
    customer: { email: 'e2e-customer@bookplus.dev', password: 'Password1!' },
    provider: { email: 'e2e-provider@bookplus.dev', password: 'Password1!' },
    // A seeded staff login (roster member 'Sam Staff') for the self-service specs.
    staff: { email: 'e2e-staff@bookplus.dev', password: 'Password1!' },
    // One email holding BOTH a customer and a business account (same password),
    // for the login destination chooser + cross-app hand-off specs.
    dual: { email: 'e2e-dual@bookplus.dev', password: 'Password1!' },
    // Both accounts again, but each side keeps its own password — the chooser
    // must still appear on the website, and choosing the business side must send
    // them to the business sign-in rather than pretending to carry them across.
    split: {
        email: 'e2e-split@bookplus.dev',
        password: 'Password1!',          // opens the CUSTOMER side
        businessPassword: 'Different1!', // opens the BUSINESS side
    },
    // A bookable team member (roster member 'Pat Provider') who has served
    // 'E2E Regular' before — the one-app member spec.
    member: { email: 'e2e-member@bookplus.dev', password: 'Password1!' },
    memberName: 'Pat Provider',
    regularName: 'E2E Regular',
    staffName: 'Sam Staff',
    serviceName: 'E2E Session',
    providerName: 'E2E Provider',
    // The dashboard addresses the owner by first name only.
    providerFirstName: 'E2E',
};

const CUSTOMER_URL = `http://localhost:${process.env.E2E_CUSTOMER_PORT || 3104}`;

// Log in on whichever app `page` is currently pointed at (same form markup).
async function login(page, { email, password }, origin = '') {
    await page.goto(`${origin}/login`);
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
}

/**
 * Assert the page is showing the signed-in provider's own dashboard.
 *
 * Two specs used to assert a heading matching /^Good (morning|afternoon|
 * evening), E2E/. No such greeting has ever existed in apps/business — the
 * specs were written against a dashboard that was never built, so they could
 * only ever fail. Landing on /dashboard is not on its own worth asserting
 * either: an unauthenticated visit is bounced to /login, so the URL alone says
 * little about WHO is signed in.
 *
 * What genuinely proves it is the calendar's own-column chip, which is built
 * from the authenticated user's name (`user.name.split(' ')[0] + ' (me)'`).
 * If the session were wrong or missing, that chip could not read "E2E (me)".
 */
async function expectProviderDashboard(page, { timeout = 15_000 } = {}) {
    await expect(page).toHaveURL(/\/dashboard/, { timeout });
    // The calendar is the default tab; its staff filter is the owner-scoped strip.
    await expect(page.getByRole('group', { name: /filter calendar by staff member/i }))
        .toBeVisible({ timeout });
    await expect(page.getByRole('button', { name: `${SEED.providerFirstName} (me)`, exact: true }))
        .toBeVisible({ timeout });
}

/**
 * Switch the calendar to a named view (Day / 3 Day / Week / Staff).
 *
 * These used to be four side-by-side buttons; the view switcher is now a
 * single dropdown in the calendar header, so `getByRole('button', {name:
 * 'Staff'})` waited forever for a control that only exists once the menu is
 * open. The trigger is found by test id rather than by name, because its name
 * IS the current view and therefore changes as the test drives it.
 */
async function openCalendarView(page, label) {
    await page.getByTestId('calendar-view-menu').click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
}

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

module.exports = { SEED, login, CUSTOMER_URL, expectProviderDashboard, openCalendarView, measureTopGap, settle };
