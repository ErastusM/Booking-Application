const { test, expect } = require('@playwright/test');
const { SEED, login, measureTopGap, settle } = require('./helpers.cjs');

/**
 * The Services tab ("Catalogue") — one screen for the owner and every team
 * member (components/ServiceMenu). The owner (E2E Provider) and Pat Provider
 * (a team member who performs E2E Session at his own N$120 / 45 min) are seeded
 * by apps/api/e2e-server.js. Alex and Billie are bookable members with no list
 * of their own (they perform everything); Sam is not bookable.
 */
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const MAX_GAP = 24;
const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;

// Straight to the API as the owner, to set up (and clear away) a crowded menu.
async function ownerApi(request) {
    const res = await request.post(`${API}/api/auth/login`, { data: { email: SEED.provider.email, password: SEED.provider.password, accountType: 'business' } });
    expect(res.ok()).toBeTruthy();
    const { token } = (await res.json()).data;
    const call = async (method, path, data) => {
        const r = await request.fetch(`${API}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data: data ? JSON.stringify(data) : undefined });
        expect(r.ok(), `${method} ${path} → ${r.status()}`).toBeTruthy();
        return (await r.json()).data;
    };
    return call;
}

// The phone layout both roles must get: a one-line "+ Add", nothing wider than
// the screen, content just under the top bar, and the first service on screen
// right under the controls (no empty band, no scrolling to find it).
async function expectPhoneLayout(page, who) {
    await page.goto('/dashboard?tab=services');
    const menu = page.getByTestId('service-menu');
    await expect(menu.getByTestId('catalogue-service').first()).toBeVisible();
    await settle(page);

    const add = menu.getByTestId('add-service');
    await expect(add).toHaveAccessibleName('Add service');
    const addBox = await add.boundingBox();
    expect(addBox.height, `${who}: "+ Add" is one line`).toBeLessThan(56);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${who}: no sideways scroll`).toBeLessThanOrEqual(0);

    const top = await page.evaluate(measureTopGap);
    expect(top.gap, `${who}: first content (${top.what}) starts ${top.gap}px below the top bar`).toBeLessThanOrEqual(MAX_GAP);

    // The first group follows the search / chip row directly…
    const geo = await page.evaluate(() => {
        const m = document.querySelector('[data-testid="service-menu"]');
        const controls = m.querySelector('.sm-chipbar') || m.querySelector('.sm-search');
        const group = m.querySelector('[data-testid="service-group"]');
        const row = m.querySelector('[data-testid="catalogue-service"]');
        const nav = document.querySelector('nav[aria-label="Bottom navigation"]');
        const navTop = nav ? Math.min(...[...nav.querySelectorAll('*')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top)) : window.innerHeight;
        return {
            controlsBottom: controls.getBoundingClientRect().bottom,
            groupTop: group.getBoundingClientRect().top,
            rowBottom: row.getBoundingClientRect().bottom,
            viewBottom: Math.min(window.innerHeight, navTop),
        };
    });
    expect(geo.groupTop - geo.controlsBottom, `${who}: gap above the first group`).toBeLessThanOrEqual(MAX_GAP);
    // …and its first row is on screen without scrolling, above the bottom nav.
    expect(geo.rowBottom, `${who}: first service row is on screen`).toBeLessThanOrEqual(geo.viewBottom);
}

test.describe('Services tab on a 390px phone', () => {
    test.use(PHONE);

    test('the owner and a team member get the same layout', async ({ page, browser, request }) => {
        // A crowded menu, as a real business has: three categories and a
        // second service with a long team line, so the chip row has to scroll.
        const api = await ownerApi(request);
        const stamp = Date.now();
        const cats = [];
        const made = [];
        try {
            for (const name of [`Hair colouring ${stamp}`, `Nails and hands ${stamp}`, `Massage ${stamp}`]) {
                const cat = await api('POST', '/categories', { name });
                cats.push(cat._id);
                const svc = await api('POST', '/services/my-services', { name: `Phone ${name}`, description: 'x', price: 856.5, duration: 90, location: 'Swakopmund', category: cat._id });
                made.push(svc._id);
            }

            await login(page, SEED.provider);
            await expectPhoneLayout(page, 'owner');
            const menu = page.getByTestId('service-menu');
            await expect(menu.getByRole('heading', { level: 2, name: 'Services' })).toBeVisible();
            await expect(menu.getByTestId('service-menu-count')).toHaveText(/services? on your menu$/);
            // The owner's rows say who performs each service; the filter row is gone.
            await expect(menu.getByRole('button', { name: `Edit ${SEED.serviceName}` }).getByTestId('catalogue-performers')).toHaveText(/^You · /);
            await expect(page.getByText('Team only')).toHaveCount(0);
            await expect(menu.getByRole('heading', { level: 3, name: /^Other services, / })).toBeVisible();

            // The chip row scrolls on its own (not the page); "Categories" sits
            // whole at its end, on screen; every price and meta line is in full.
            const geo = await page.evaluate(() => {
                const m = document.querySelector('[data-testid="service-menu"]');
                const chips = m.querySelector('.sm-chips');
                const manage = m.querySelector('[data-testid="manage-categories"]').getBoundingClientRect();
                const cut = (el) => el.scrollWidth > el.clientWidth + 1;
                return {
                    chipsScroll: chips.scrollWidth > chips.clientWidth,
                    fade: chips.getAttribute('data-fade'),
                    manageInside: manage.left >= 0 && manage.right <= window.innerWidth,
                    manageInChips: chips.contains(m.querySelector('[data-testid="manage-categories"]')),
                    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    pricesInside: [...m.querySelectorAll('.sm-price')].every((p) => p.getBoundingClientRect().right <= window.innerWidth),
                    metaCut: [...m.querySelectorAll('.sm-meta, .sm-meta-part')].filter(cut).map((e) => e.textContent),
                };
            });
            expect(geo.chipsScroll, 'the chip row scrolls sideways').toBe(true);
            expect(geo.fade, 'a fade shows there are more chips').toBe('end');
            expect(geo.pageOverflow, 'the page itself never scrolls sideways').toBeLessThanOrEqual(0);
            expect(geo.manageInChips, '"Categories" is not in the scrolling row').toBe(false);
            expect(geo.manageInside, '"Categories" is fully on screen').toBe(true);
            expect(geo.pricesInside, 'every price is on screen').toBe(true);
            expect(geo.metaCut, 'no meta line is cut off').toEqual([]);
            await expect(menu.getByRole('button', { name: 'Categories' })).toBeInViewport({ ratio: 1 });
        } finally {
            for (const id of made) await api('DELETE', `/services/${id}`);
            for (const id of cats) await api('DELETE', `/categories/${id}`);
        }

        const ctx = await browser.newContext(PHONE);
        const member = await ctx.newPage();
        await login(member, SEED.member);
        await expectPhoneLayout(member, 'member');
        const mine = member.getByTestId('service-menu');
        await expect(mine.getByTestId('service-menu-count')).toHaveText('1 service clients can book you for');
        const row = mine.getByRole('button', { name: `Edit ${SEED.serviceName}` });
        await expect(row).toContainText('45 min');
        await expect(row).toContainText('N$ 120');
        // The town shows for a member as it does for the owner.
        await expect(row).toContainText('📍 Windhoek');
        await expect(mine.getByTestId('catalogue-performers')).toHaveCount(0);
        await expect(mine.getByRole('button', { name: 'Categories' })).toHaveCount(0);
        await ctx.close();
    });
});

test.describe('Services tab: what left the rows still works', () => {
    test.use({ viewport: { width: 1280, height: 860 } });

    test('owner offers / stops offering, manages categories, a member adds and removes, the owner deletes', async ({ page, browser }) => {
        // Unique per attempt: the e2e database outlives a failed first try.
        const NAME = `Catalogue Trial ${Date.now()}`;
        const CAT = `E2E Colour ${Date.now()}`;
        await login(page, SEED.provider);
        await page.goto('/dashboard?tab=services');
        const menu = page.getByTestId('service-menu');
        await expect(menu.getByTestId('catalogue-service').first()).toBeVisible();

        // Add a service (the owner offers it by default).
        await menu.getByTestId('add-service').click();
        await page.getByTestId('service-name').fill(NAME);
        await page.getByTestId('service-price').fill('75');
        await page.getByRole('button', { name: /^save$/i }).click();
        const row = menu.getByRole('button', { name: `Edit ${NAME}` });
        await expect(row).toContainText('N$ 75');
        // Alex and Billie perform everything; Pat only his own; Sam isn't bookable.
        await expect(row.getByTestId('catalogue-performers')).toHaveText('You · Alex · Billie');

        // The editor is a modal dialog: it opens on itself (no keyboard popping
        // up just to look), Escape closes it, and focus comes back to the row.
        await row.click();
        const editor = page.getByRole('dialog', { name: 'Edit service' });
        await expect(editor).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(editor).toHaveCount(0);
        await expect(row).toBeFocused();

        // "I offer this" off, in the editor: only the team can be booked for it.
        await row.click();
        await expect(page.getByRole('heading', { name: 'Edit service' })).toBeVisible();
        await expect(page.getByRole('switch', { name: 'You offer this service' })).toBeChecked();
        await page.getByTestId('service-owner-performs').setChecked(false);
        const [off] = await Promise.all([
            page.waitForResponse((r) => /\/api\/services\/[0-9a-f]{24}$/.test(r.url()) && r.request().method() === 'PUT'),
            page.getByRole('button', { name: 'Save changes' }).click(),
        ]);
        expect((await off.json()).data.ownerPerforms).toBe(false);
        await expect(row.getByTestId('catalogue-performers')).toHaveText('Only Alex · Billie');
        await expect(row).toBeFocused();
        // …and back on.
        await row.click();
        await expect(page.getByTestId('service-owner-performs')).not.toBeChecked();
        await page.getByTestId('service-owner-performs').setChecked(true);
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(row.getByTestId('catalogue-performers')).toHaveText('You · Alex · Billie');

        // Categories: add one in the sheet, file the service under it, filter by
        // its chip, then delete it — the service moves to "Other services".
        const manage = menu.getByRole('button', { name: 'Categories' });
        await manage.click();
        const sheet = page.getByRole('dialog', { name: 'Categories' });
        await sheet.getByRole('textbox', { name: 'New category name' }).fill(CAT);
        await sheet.getByRole('button', { name: 'Add category' }).click();
        await expect(sheet.getByTestId('category-row').filter({ hasText: CAT })).toContainText('0 services');
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(manage).toBeFocused();

        await row.click();
        await page.getByTestId('service-category').click();
        await page.getByTestId('service-category-popup').getByRole('option', { name: CAT }).click();
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(menu.getByRole('heading', { level: 3, name: `${CAT}, 1 service` })).toBeVisible();
        await expect(menu.getByRole('heading', { level: 3, name: /^Other services, / })).toBeVisible();
        await expect(page.getByText('Featured')).toHaveCount(0);
        const chip = menu.getByTestId('category-chip').filter({ hasText: CAT });
        await chip.click();
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
        await expect(menu.getByTestId('catalogue-service')).toHaveCount(1);
        await menu.getByTestId('category-chip').filter({ hasText: /^All/ }).click();

        await manage.click();
        await sheet.getByRole('button', { name: `Delete ${CAT}` }).click();
        await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete' }).click();
        await expect(sheet.getByTestId('category-row').filter({ hasText: CAT })).toHaveCount(0);
        await sheet.getByRole('button', { name: 'Close' }).click();
        await expect(menu.getByRole('heading', { level: 3, name: `${CAT}, 1 service` })).toHaveCount(0);
        await expect(menu.getByTestId('category-chip')).toHaveCount(0);
        await expect(row).toBeVisible();

        // A team member takes it on from the business's menu (the owner's price
        // is never shown there), then removes it from the editor.
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
        const pat = await ctx.newPage();
        await login(pat, SEED.member);
        await pat.goto('/dashboard?tab=services');
        const patMenu = pat.getByTestId('service-menu');
        const also = patMenu.getByTestId('menu-services');
        await expect(also.getByRole('heading', { name: `Also on ${SEED.providerName}’s menu` })).toBeVisible();
        await expect(also).toContainText(NAME);
        await expect(also).not.toContainText('N$');
        await Promise.all([
            pat.waitForResponse((r) => r.url().includes('/team/mine/services') && r.request().method() === 'PUT'),
            also.getByRole('button', { name: `Add ${NAME} to my services` }).click(),
        ]);
        const patRow = patMenu.getByRole('button', { name: `Edit ${NAME}` });
        await expect(patRow).toBeVisible();
        // Focus follows the service to its new row (no toast over the list).
        await expect(patRow).toBeFocused();
        await expect(patRow.getByTestId('catalogue-performers')).toHaveCount(0);
        await expect(patMenu.getByTestId('menu-add-service')).toHaveCount(0);

        await patRow.click();
        await expect(pat.getByTestId('service-owner-performs')).toHaveCount(0);
        // Cancelling keeps the editor open, the service on the list, and focus
        // on the button.
        const remove = pat.getByRole('button', { name: 'Remove from my services' });
        await remove.click();
        await pat.getByTestId('confirm-dialog').getByRole('button', { name: 'Cancel' }).click();
        await expect(pat.getByRole('heading', { name: 'Edit service' })).toBeVisible();
        await expect(remove).toBeFocused();
        await remove.click();
        await Promise.all([
            pat.waitForResponse((r) => r.url().includes('/team/mine/services') && r.request().method() === 'PUT'),
            pat.getByTestId('confirm-dialog').getByRole('button', { name: 'Remove' }).click(),
        ]);
        await expect(pat.getByRole('heading', { name: 'Edit service' })).toHaveCount(0);
        await expect(patRow).toHaveCount(0);
        await expect(also.getByRole('button', { name: `Add ${NAME} to my services` })).toBeVisible();
        await ctx.close();

        // The owner deletes it from the bottom of the editor (after first
        // changing their mind once: Cancel keeps it).
        await row.click();
        const del = page.getByRole('button', { name: 'Delete service' });
        await del.click();
        await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByRole('heading', { name: 'Edit service' })).toBeVisible();
        await expect(del).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(row).toBeVisible();
        await row.click();
        await del.click();
        await Promise.all([
            page.waitForResponse((r) => /\/api\/services\/[0-9a-f]{24}$/.test(r.url()) && r.request().method() === 'DELETE'),
            page.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete' }).click(),
        ]);
        await expect(page.getByRole('heading', { name: 'Edit service' })).toHaveCount(0);
        await expect(row).toHaveCount(0);
    });
});
