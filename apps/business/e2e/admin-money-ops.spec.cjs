const { test, expect } = require('@playwright/test');
const { adminWithTwoStep, adminConsoleLogin, adminSection } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;

/**
 * Bookplus's money work in the admin console, end to end: a business owed
 * money from a booking paid online (stand-in PayGate) is paid out (prepared,
 * bank file, marked paid with the bank's reference), then a client's
 * complaint about the same booking is opened as a case and the client is
 * refunded from it.
 */
const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('Money operations (admin)', () => {
    test('payout run, then a complaint refunded from a case', async ({ page, request }) => {
        test.setTimeout(120_000);
        const fx = await (await request.post(`${API}/__e2e/paying-business`, { data: { mode: 'full' } })).json();
        const paid = await (await request.post(`${API}/__e2e/paygate/paid-booking`, {
            data: { serviceId: fx.serviceId, date: tomorrow(), startTime: '11:00', endTime: '11:30', guestName: 'Selma Nghipandulwa' },
        })).json();
        expect(paid.ok).toBe(true);

        await page.setViewportSize({ width: 390, height: 844 });
        const admin = await adminWithTwoStep(request);
        await adminConsoleLogin(page, admin);
        // Payouts: due, prepared (only this business), the bank file, paid.
        await adminSection(page, 'Payouts');
        const due = page.getByTestId('ops-payouts-due');
        const mine = due.getByLabel(`Pay ${fx.businessName}`);
        await expect(mine).toBeChecked();
        for (const box of await due.getByRole('checkbox', { checked: true }).all()) await box.uncheck();
        await mine.check();
        await expect(due).toContainText('N$192.50');
        await due.getByRole('button', { name: 'Prepare 1 payout (N$192.50)' }).click();
        const onWay = page.getByTestId('ops-payout').filter({ hasText: fx.businessName });
        await expect(onWay).toContainText(/ref BPP[0-9A-F]{10}/);
        const [file] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('button', { name: 'Download bank file (CSV)' }).click(),
        ]);
        expect(file.suggestedFilename()).toMatch(/^bookplus-payouts-\d{4}-\d{2}-\d{2}\.csv$/);
        await onWay.getByRole('button', { name: 'Paid' }).click();
        await onWay.getByLabel(/bank's reference/).fill('BW-55120');
        await onWay.getByRole('button', { name: 'Mark paid' }).click();
        await expect(page.getByTestId('ops-payout-recent').filter({ hasText: fx.businessName })).toContainText('BW-55120');
        await expect(page.getByTestId('ops-payout').filter({ hasText: fx.businessName })).toHaveCount(0);

        // Payments: the booking's payment; a complaint becomes a case.
        await adminSection(page, 'Payments');
        await page.getByLabel('Payment reference').fill(paid.reference);
        await page.getByRole('button', { name: 'Find' }).click();
        await page.getByRole('button', { name: 'Paid', exact: true }).click();
        const pay = page.getByTestId('ops-payment').filter({ hasText: fx.businessName });
        await expect(pay).toContainText('Selma Nghipandulwa');
        await pay.getByRole('button', { name: 'Open a case' }).click();
        await pay.getByLabel('What it is about').fill('Client arrived and the salon was closed');
        await pay.getByRole('button', { name: 'Open the case' }).click();

        // The case opens; the client is refunded from it (below the approval limit: at once).
        const kase = page.getByTestId('ops-dispute');
        await expect(kase).toContainText(`Service not provided: ${fx.businessName}`);
        await kase.getByRole('button', { name: 'Refund the client' }).click();
        await kase.getByLabel('Why').fill('Salon was closed');
        await kase.getByRole('button', { name: 'Prepare the refund' }).click();
        await expect(page.getByTestId('ops-dispute-status')).toHaveText('Client refunded');

        // No sideways scrolling on a phone.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        // Costs: this month's running costs (this admin holds both roles).
        await adminSection(page, 'Costs');
        const costs = page.getByTestId('finance-costs');
        await costs.getByRole('button', { name: 'Add a cost' }).click();
        await costs.getByLabel('What it is').fill('Server');
        await costs.getByLabel('Amount (N$)').fill('400');
        await costs.getByLabel('Why (for the audit log)').fill('Hosting bill');
        await costs.getByRole('button', { name: 'Save the costs' }).click();
        await expect(page.getByText('Saved')).toBeVisible();

        // Dashboard: the booking paid online is counted; the running costs are set against it.
        await adminSection(page, 'Dashboard');
        const dash = page.getByTestId('finance-dashboard');
        await expect(dash.getByTestId('dash-bookings')).not.toContainText('No bookings paid online');
        await expect(dash.getByTestId('dash-breakeven')).toContainText('running costs');
        await expect(dash.getByTestId('dash-costs')).toContainText('Running costs: Hosting');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
