const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

// No page may overflow horizontally — the #1 cause of a "janky" mobile feel.
const VIEWPORTS = [
    { name: 'iPhone SE', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
];

async function expectNoHorizontalScroll(page) {
    // Allow a 2px rounding tolerance
    const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);
}

test.describe('Responsiveness — no horizontal overflow', () => {
    for (const vp of VIEWPORTS) {
        test(`public pages fit ${vp.name} (${vp.width}px)`, async ({ page }) => {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            for (const path of ['/', '/login', '/register', '/services']) {
                await page.goto(path);
                await page.waitForLoadState('networkidle');
                await expectNoHorizontalScroll(page);
            }
        });
    }

    test('customer booking page fits 375px', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await login(page, SEED.customer);
        // Was '/services', which now redirects to the home feed — the provider is
        // reached from the feed itself.
        await page.goto('/');
        await page.getByText(SEED.providerName, { exact: false }).first().click();
        await page.getByRole('button', { name: /book now/i }).first().click();
        await page.waitForLoadState('networkidle');
        await expectNoHorizontalScroll(page);
    });

    // The provider dashboard lives in apps/business now — its responsive
    // coverage belongs to that app's future suite.
});
