const { test, expect } = require('@playwright/test');
const { login } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;

/**
 * A business's money from online payments, in the browser: what Bookplus owes
 * it, each booking paid online with what Bookplus kept, a refund it can cover
 * (it runs at once), one it can't (it goes to Bookplus to approve), the
 * statement, and the booking's details. The bookings are paid on a stand-in
 * PayGate (E2E_FAKE_PAYGATE) before the business signs in.
 */
const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('Online payments: the business side', () => {
    test('balance, fees, a refund, a refund for Bookplus to approve, statement, booking details', async ({ page, request }) => {
        test.setTimeout(120_000);
        // Standard plan (3% + N$1.50), full price N$200 online.
        const fx = await (await request.post(`${API}/__e2e/paying-business`, { data: { mode: 'full' } })).json();
        const paid = await (await request.post(`${API}/__e2e/paygate/paid-booking`, {
            data: { serviceId: fx.serviceId, date: tomorrow(), startTime: '10:00', endTime: '10:30', guestName: 'Ana Shilongo' },
        })).json();
        expect(paid.ok).toBe(true);

        await page.setViewportSize({ width: 390, height: 844 });
        await login(page, { email: fx.ownerEmail, password: 'Password1!' });
        await page.goto('/account?section=payments');

        // N$200 paid, less N$6.00 commission and the N$1.50 fixed fee.
        await expect(page.getByTestId('money-owed')).toHaveText('N$192.50');
        const row = page.getByTestId('money-payment').filter({ hasText: 'Ana' });
        await expect(row).toContainText('Paid in full');
        await row.getByRole('button', { name: 'Fees' }).click();
        await expect(row).toContainText('You getN$192.50');

        // N$50 back: within the balance, so it runs now.
        await row.getByRole('button', { name: 'Refund' }).click();
        const dlg = page.getByTestId('refund-dialog');
        await dlg.getByLabel(/Amount/).fill('50');
        await dlg.getByLabel('Why').fill('Started late');
        await dlg.getByRole('button', { name: 'Refund N$50.00' }).click();
        await expect(dlg).toBeHidden();
        await expect(row).toContainText('Partly refunded');
        // N$50 less, and the commission on it (N$1.50) given back.
        await expect(page.getByTestId('money-owed')).toHaveText('N$144.00');

        // The other N$150 is more than the N$144 it holds: Bookplus approves it.
        await row.getByRole('button', { name: 'Refund' }).click();
        await expect(dlg.getByLabel(/Amount/)).toHaveValue('150.00');
        await dlg.getByLabel('Why').fill('Client was ill');
        await dlg.getByRole('button', { name: 'Refund N$150.00' }).click();
        await expect(page.getByText('sent to Bookplus to approve', { exact: false })).toBeVisible();
        await expect(row).toContainText('Waiting for Bookplus to approve a N$150.00 refund');
        await expect(row.getByRole('button', { name: 'Refund' })).toHaveCount(0);

        // The statement: every line, newest first, and a CSV.
        const statement = page.getByTestId('money-statement');
        await expect(statement.getByTestId('money-statement-row').first()).toContainText('Bookplus commission');
        await expect(statement).toContainText('Refund: Ana');
        await expect(statement).toContainText('Bookplus commission returned: Ana');
        await expect(statement).toContainText('Online payment: Ana');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            statement.getByRole('button', { name: 'Download (CSV)' }).click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/^bookplus-statement-\d{4}-\d{2}-\d{2}\.csv$/);

        // No sideways scrolling on a phone.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        // The booking's details say what was paid and refunded.
        // (The calendar opens on three days from today, so tomorrow is on it.)
        await page.goto('/dashboard');
        await page.getByRole('button', { name: 'Ana Shilongo' }).first().click();
        await expect(page.getByTestId('appt-online-payment')).toHaveText('N$200.00 paid · N$50.00 refunded');
        await expect(page.getByTestId('appt-refund')).toBeVisible();
    });
});
