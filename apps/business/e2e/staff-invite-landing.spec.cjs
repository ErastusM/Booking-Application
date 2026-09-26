const { test, expect, devices } = require('@playwright/test');
const { SEED } = require('./helpers.cjs');

/**
 * "The create-password screen for the invited team member disappears before
 * they can even create a password, then they're asked to sign in."
 *
 * Root causes this pins, on a phone:
 *  1. a dead business session already on the device made the invite page's
 *     background calls 401 → failed refresh → forceLogout → /login (~0.2–0.65s)
 *  2. every Resend overwrote the one invite token, killing the email a member
 *     had open (and every earlier email)
 *  3. an expired link was a dead end ("Go to sign in" only)
 *
 * Invite links are read from the e2e API's outbox (apps/api/e2e-server.js).
 */

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;
const { defaultBrowserType, ...PHONE } = devices['Pixel 7'];
test.use({ ...PHONE });

const PASSWORD = 'Welcome1!';
let seq = 0;
const uniqueEmail = (tag) => `invite-${tag}-${Date.now()}-${++seq}@e2e.test`;

const api = async (request, method, path, { token, data } = {}) => {
    const res = await request.fetch(`${API}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        data: data ? JSON.stringify(data) : undefined,
    });
    let body = null;
    try { body = await res.json(); } catch { /* empty */ }
    return { status: res.status(), body };
};

const signIn = async (request, { email, password }) => {
    const r = await api(request, 'POST', '/api/auth/login', { data: { email, password, accountType: 'business' } });
    expect(r.status).toBe(200);
    return r.body.data;
};

const addMember = async (request, owner, email, name = 'Ivy Invitee') => {
    const r = await api(request, 'POST', '/api/team', { token: owner.token, data: { name, role: 'Stylist', email } });
    expect(r.status).toBe(201);
    return r.body.data._id;
};

const invite = async (request, owner, memberId, body = {}) => {
    const r = await api(request, 'POST', `/api/team/${memberId}/invite`, { token: owner.token, data: body });
    expect(r.status).toBe(200);
    return r.body.data;
};

const inviteLinks = async (request, email) => {
    const r = await request.get(`${API}/__e2e/outbox?to=${encodeURIComponent(email)}`);
    const mails = await r.json();
    return mails.filter((m) => m.fn === 'sendStaffInviteEmail').map((m) => `/accept-invite?token=${m.args[3]}`);
};

const age = (request, email, ms, expire = false) =>
    request.post(`${API}/__e2e/invites/age`, { data: { email, ms, expire } });

// The form must still be there — same page, inputs usable — for `ms`.
const expectFormStays = async (page, ms = 10_000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        expect(new URL(page.url()).pathname).toBe('/accept-invite');
        await expect(page.getByTestId('accept-password')).toBeVisible({ timeout: 1000 });
        await page.waitForTimeout(500);
    }
};

const acceptWith = async (page, password = PASSWORD) => {
    await page.getByTestId('accept-password').fill(password);
    await page.getByTestId('accept-confirm').fill(password);
    await page.getByTestId('accept-submit').click();
};

const expectOnCalendar = async (page) => {
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page.getByTestId('calendar-view-menu')).toBeVisible({ timeout: 15_000 });
};

test.describe('Invited member lands on the create-password form and stays there', () => {
    test('a revoked session + cached user on the device: the form stays for 10s and accepting lands on the calendar', async ({ page, request }) => {
        const owner = await signIn(request, SEED.provider);
        const email = uniqueEmail('dead');
        const id = await addMember(request, owner, email);
        await invite(request, owner, id);
        const [link] = await inviteLinks(request, email);

        // Someone else's business session on this phone, then revoked server-side
        // (logout elsewhere bumps tokenVersion; refresh fails too).
        const sam = await signIn(request, SEED.staff);
        expect((await api(request, 'POST', '/api/auth/logout', { token: sam.token })).status).toBe(200);
        await page.goto('/terms');
        await page.evaluate((s) => {
            localStorage.setItem('token', s.token);
            localStorage.setItem('refreshToken', s.refreshToken);
            localStorage.setItem('user', JSON.stringify(s.user));
        }, sam);

        const calls = [];
        page.on('request', (r) => { if (r.url().startsWith(API)) calls.push(new URL(r.url()).pathname); });

        await page.goto(link);
        await expect(page.getByTestId('invite-title')).toContainText('You’re joining');
        await expect(page.getByTestId('invite-device-session')).toContainText(SEED.staffName);
        // Rules are shown before typing.
        await expect(page.getByTestId('accept-rules').locator('li')).toHaveCount(4);
        await expectFormStays(page);
        // Nothing on this page touched the dead session.
        expect(calls.filter((p) => /\/auth\/(profile|refresh|sibling)|\/notifications/.test(p))).toEqual([]);

        await acceptWith(page);
        await expectOnCalendar(page);
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('user') || 'null'));
        expect(stored && stored.email).toBe(email);
    });

    test('the owner resends while the form is open: submitting still works', async ({ page, request }) => {
        const owner = await signIn(request, SEED.provider);
        const email = uniqueEmail('resend');
        const id = await addMember(request, owner, email);
        await invite(request, owner, id);
        const [first] = await inviteLinks(request, email);

        await page.goto(first);
        await expect(page.getByTestId('accept-password')).toBeVisible();
        await page.getByTestId('accept-password').fill(PASSWORD);

        await age(request, email, 2 * 60 * 1000);     // past the 60s double-tap throttle
        await invite(request, owner, id);              // owner taps Resend
        expect(await inviteLinks(request, email)).toHaveLength(2);

        await page.getByTestId('accept-confirm').fill(PASSWORD);
        await page.getByTestId('accept-submit').click();
        await expectOnCalendar(page);
    });

    test('the first of 4 invite emails works', async ({ page, request }) => {
        const owner = await signIn(request, SEED.provider);
        const email = uniqueEmail('four');
        const id = await addMember(request, owner, email);
        for (let i = 0; i < 4; i++) {
            await invite(request, owner, id);
            await age(request, email, 2 * 60 * 1000);
        }
        const links = await inviteLinks(request, email);
        expect(links).toHaveLength(4);

        await page.goto(links[0]);
        await acceptWith(page);
        await expectOnCalendar(page);
    });

    test('expired → "Email me a new link" → the new link works', async ({ page, request }) => {
        const owner = await signIn(request, SEED.provider);
        const email = uniqueEmail('expired');
        const id = await addMember(request, owner, email);
        await invite(request, owner, id);
        const [old] = await inviteLinks(request, email);
        await age(request, email, 8 * 24 * 3600 * 1000, true);

        await page.goto(old);
        await expect(page.getByTestId('invite-expired')).toBeVisible();
        await expect(page.getByTestId('invite-expired')).toContainText('This invite has expired');
        await expect(page.getByTestId('invite-signin-link')).toHaveText('Already set a password? Sign in');
        await page.getByTestId('invite-new-link-button').click();
        await expect(page.getByTestId('invite-new-link-sent')).toBeVisible();

        await expect.poll(async () => (await inviteLinks(request, email)).length).toBe(2);
        const links = await inviteLinks(request, email);
        await page.goto(links[1]);
        await acceptWith(page);
        await expectOnCalendar(page);
    });

    test('reopening an accepted link says "You’re already set up"', async ({ page, request }) => {
        const owner = await signIn(request, SEED.provider);
        const email = uniqueEmail('reopen');
        const id = await addMember(request, owner, email);
        await invite(request, owner, id);
        const [link] = await inviteLinks(request, email);

        await page.goto(link);
        await acceptWith(page);
        await expectOnCalendar(page);

        await page.goto(link);
        await expect(page.getByTestId('invite-accepted')).toContainText('You’re already set up');
        await page.getByTestId('invite-go-calendar').click();
        await expectOnCalendar(page);

        // On another device (no session): Sign in, with the email filled in.
        await page.evaluate(() => localStorage.clear());
        await page.context().clearCookies();
        await page.goto(link);
        await page.getByTestId('invite-sign-in').click();
        await expect(page).toHaveURL(/\/login/);
        await expect(page.getByPlaceholder('you@example.com')).toHaveValue(email);
    });

    for (const tier of ['basic', 'low', 'medium', 'high']) {
        test(`a ${tier}-level member lands on their calendar after accepting`, async ({ page, request }) => {
            const owner = await signIn(request, SEED.provider);
            const email = uniqueEmail(`tier-${tier}`);
            const id = await addMember(request, owner, email, `Tier ${tier}`);
            await invite(request, owner, id, { tier });
            const [link] = await inviteLinks(request, email);
            await page.goto(link);
            await acceptWith(page);
            await expectOnCalendar(page);
        });
    }
});

test.describe('Sign-in after a lapsed session', () => {
    test('says why and returns to the interrupted page', async ({ page }) => {
        await page.goto('/login?error=session_expired&next=%2Fteam');
        await expect(page.getByTestId('login-session-notice')).toHaveText('Your session ended, sign in again.');
        await page.getByPlaceholder('you@example.com').fill(SEED.provider.email);
        await page.getByPlaceholder('••••••••').fill(SEED.provider.password);
        await page.getByRole('button', { name: /sign in/i }).click();
        await expect(page).toHaveURL(/\/team$/);
    });

    test('ignores an off-site next', async ({ page }) => {
        await page.goto('/login?next=%2F%2Fevil.example');
        await page.getByPlaceholder('you@example.com').fill(SEED.provider.email);
        await page.getByPlaceholder('••••••••').fill(SEED.provider.password);
        await page.getByRole('button', { name: /sign in/i }).click();
        await expect(page).toHaveURL(/localhost:\d+\/dashboard/);
    });
});
