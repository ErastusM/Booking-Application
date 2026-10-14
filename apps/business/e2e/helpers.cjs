// Shared helpers + seeded credentials for the business-app E2E specs.
// Accounts are created by apps/api/e2e-server.js on boot.
const crypto = require('crypto');
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

const E2E_API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;

// What an authenticator app shows (RFC 6238: HMAC-SHA1, 30-second steps).
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const totp = (secret, offset = 0) => {
    let bits = 0; let value = 0; const bytes = [];
    for (const ch of secret.replace(/\s/g, '')) {
        value = (value << 5) | B32.indexOf(ch); bits += 5;
        if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
    const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
    const o = h[h.length - 1] & 0xf;
    const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 1e6).padStart(6, '0');
};

// A fresh admin with two-step sign-in turned on through the API.
async function adminWithTwoStep(request) {
    const admin = await (await request.post(`${E2E_API}/__e2e/fresh-admin`)).json();
    const login = await (await request.post(`${E2E_API}/api/auth/login`, { data: { ...admin, accountType: 'business' } })).json();
    const headers = { Authorization: `Bearer ${login.data.token}` };
    const setup = await (await request.post(`${E2E_API}/api/auth/mfa/setup`, { headers })).json();
    const on = await request.post(`${E2E_API}/api/auth/mfa/enable`, { headers, data: { code: totp(setup.data.secret) } });
    expect(on.status()).toBe(200);
    return { ...admin, secret: setup.data.secret };
}

// Sign in at the admin door with password and code, landing on the console.
async function adminConsoleLogin(page, admin) {
    await page.goto('/bkplus-command/login');
    await page.getByLabel('Admin email').fill(admin.email);
    await page.getByLabel('Password').fill(admin.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByTestId('admin-mfa-code').fill(totp(admin.secret, 1));
    await page.getByRole('button', { name: /confirm/i }).click();
    await page.waitForURL(/\/bkplus-command$/, { timeout: 15_000 });
}

// Open a section of the admin console from its sidebar (on a phone, the
// sidebar is a drawer behind the menu button). Counts ("Payments 2 waiting")
// are allowed after the name.
async function adminSection(page, name) {
    await page.getByTestId('admin-console').waitFor();
    const menu = page.getByRole('button', { name: 'Open menu' });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('navigation', { name: 'Admin' })
        .getByRole('link', { name: new RegExp(`^${name}( \\d+ waiting)?$`) }).click();
}

module.exports = { SEED, login, CUSTOMER_URL, expectProviderDashboard, openCalendarView, measureTopGap, settle, totp, adminWithTwoStep, adminConsoleLogin, adminSection };
