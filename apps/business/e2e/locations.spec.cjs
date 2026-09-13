const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

/**
 * Locations management (owner screen over the multi-location CRUD).
 *
 * The e2e API seeds no locations and persists across tests, so this uses UNIQUE
 * names per run and asserts on the specific rows it creates rather than global
 * counts — it never assumes a clean slate.
 */
test.describe('Locations management', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, SEED.provider);
        await page.waitForURL(/\/dashboard/);
        await page.goto('/account');
        await page.getByRole('button', { name: 'Locations', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Locations' })).toBeVisible();
    });

    test('owner can add locations and promote one to primary', async ({ page }) => {
        const stamp = Date.now();
        const A = `Downtown-${stamp}`;
        const B = `Uptown-${stamp}`;
        const add = async (name) => {
            await page.getByLabel('New location name').fill(name);
            await page.getByRole('button', { name: 'Add location' }).click();
            await expect(page.getByTestId('location-row').filter({ hasText: name })).toBeVisible();
        };

        await add(A);
        await add(B);

        // A freshly-added, non-primary location can be promoted; afterwards it wears
        // the Primary badge. (Whether A or a pre-existing row was primary before is
        // irrelevant — this asserts the transition, not the starting state.)
        const rowB = page.getByTestId('location-row').filter({ hasText: B });
        await rowB.getByRole('button', { name: 'Make primary' }).click();
        await expect(rowB.getByText('Primary')).toBeVisible();
    });

    test('renaming a location persists', async ({ page }) => {
        const original = `Branch-${Date.now()}`;
        const renamed = `${original}-renamed`;
        await page.getByLabel('New location name').fill(original);
        await page.getByRole('button', { name: 'Add location' }).click();

        const row = page.getByTestId('location-row').filter({ hasText: original });
        await expect(row).toBeVisible();
        await row.getByRole('button', { name: 'Edit' }).click();
        // Only one row edits at a time, so its name input + Save are unique page-wide
        // (display-mode rows show text, not inputs). The row locator itself can't be
        // reused here — the name has moved out of the row's text and into the input.
        // exact:true — otherwise the default substring match also hits the add
        // form's "New location name" input.
        await page.getByRole('textbox', { name: 'Location name', exact: true }).fill(renamed);
        await page.getByRole('button', { name: 'Save' }).click();

        await expect(page.getByTestId('location-row').filter({ hasText: renamed })).toBeVisible();
    });
});
