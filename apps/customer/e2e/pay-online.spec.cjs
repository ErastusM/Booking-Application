const { test, expect } = require('@playwright/test');
const { SEED, login } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5052}`;

/**
 * Paying online for a booking, end to end, against a stand-in PayGate
 * (E2E_FAKE_PAYGATE): the review step says what is due now and at the
 * appointment, Confirm sends the browser to PayGate's hosted page, and the
 * client comes back to /booking/payment with the outcome. The hosted page is
 * played here: it posts back to the API's return address with what PayGate
 * would send, exactly as the real page does.
 */

// Play PayGate's hosted page: read the reference the browser posted, set the
// outcome on the stand-in, and post the browser back to the API.
const playPayGate = (page, request, outcome) => page.route('https://secure.paygate.co.za/**', async (route) => {
    const form = new URLSearchParams(route.request().postData() || '');
    const reference = form.get('REFERENCE');
    const code = typeof outcome === 'function' ? outcome() : outcome;
    const r = await (await request.post(`${API}/__e2e/paygate/outcome`, { data: { reference, code } })).json();
    const fields = [...new URLSearchParams(r.returnBody)]
        .map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`).join('');
    await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><body><p>PayGate (test)</p><form id="f" method="POST" action="${API}/api/payments/paygate/return">${fields}</form><script>document.getElementById('f').submit()</script></body></html>`,
    });
});

const bookOnePaidSlot = async (page, fx) => {
    await page.goto(`/book-appointment?providerId=${fx.providerId}`);
    await page.getByTestId('booking-service').first().click();
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.locator('[data-testid="booking-date"]:not([disabled])').first().click();
    await page.getByTestId('booking-time').first().click();
    await page.getByTestId('booking-continue').click();
};

test.describe('Paying online for a booking', () => {
    test('a 25% deposit: shown before confirming, paid on PayGate, booked', async ({ page, request }) => {
        const fx = await (await request.post(`${API}/__e2e/paying-business`, { data: { mode: 'deposit' } })).json();
        await login(page, SEED.customer);
        await playPayGate(page, request, 1);
        await bookOnePaidSlot(page, fx);

        // The review step says what is due now, what is left, and the refund rules.
        const pay = page.getByTestId('review-pay-online');
        await expect(pay).toContainText('Pay N$50.00 now by card as a deposit');
        await expect(pay).toContainText('The rest, N$150.00, is paid at your appointment');
        await expect(page.getByTestId('review-refund-rules')).toContainText('If the business cancels, you get it all back');
        await page.getByRole('button', { name: 'Confirm and pay N$50.00' }).first().click();

        // Back from PayGate: paid and booked.
        await page.waitForURL(/\/booking\/payment\?ref=BP[0-9A-F]{30}/, { timeout: 20_000 });
        const result = page.getByTestId('payment-result');
        await expect(result).toHaveAttribute('data-view', 'paid', { timeout: 15_000 });
        const paidUrl = page.url();
        await expect(result).toContainText('Paid and booked');
        await expect(page.getByTestId('payment-booking')).toContainText(fx.businessName);
        await expect(page.getByTestId('payment-booking')).toContainText('Deposit paid: N$50.00');
        await result.getByRole('link', { name: 'See my appointments' }).click();
        await expect(page).toHaveURL(/\/appointments/);

        // My appointments says what was paid and what is left.
        const line = page.getByTestId('appt-online-payment').filter({ hasText: 'N$50.00' }).first();
        await expect(line).toContainText('Deposit paid online: N$50.00');
        await expect(line).toContainText('N$150.00 at the appointment');

        // So does the emailed "manage my booking" page.
        const reference = new URL(paidUrl).searchParams.get('ref');
        const { token } = await (await request.post(`${API}/__e2e/paygate/manage-token`, { data: { reference } })).json();
        await page.goto(`/manage/${token}`);
        await expect(page.getByTestId('manage-online-payment')).toHaveText('Deposit paid online: N$50.00, N$150.00 at the appointment');
    });

    test('declined first: the time stays held, "Try again" pays it', async ({ page, request }) => {
        const fx = await (await request.post(`${API}/__e2e/paying-business`, { data: { mode: 'full' } })).json();
        await login(page, SEED.customer);
        let attempt = 0;
        await playPayGate(page, request, () => { attempt += 1; return attempt === 1 ? 2 : 1; });
        await bookOnePaidSlot(page, fx);
        await expect(page.getByTestId('review-pay-online')).toContainText('Pay N$200.00 now by card, the full price');
        await page.getByRole('button', { name: 'Confirm and pay N$200.00' }).first().click();

        await page.waitForURL(/\/booking\/payment\?ref=/, { timeout: 20_000 });
        const result = page.getByTestId('payment-result');
        await expect(result).toHaveAttribute('data-view', 'failed', { timeout: 15_000 });
        await expect(result).toContainText('Nothing was taken');
        await result.getByRole('button', { name: 'Try again' }).click();

        await page.waitForURL(/\/booking\/payment\?ref=/, { timeout: 20_000 });
        await expect(page.getByTestId('payment-result')).toHaveAttribute('data-view', 'paid', { timeout: 15_000 });
        await expect(page.getByTestId('payment-booking')).toContainText('Paid in full: N$200.00');
    });

    test('a payment reference nobody knows says so, and offers the way back', async ({ page }) => {
        await page.goto('/booking/payment?ref=BP000000000000000000000000000000');
        await expect(page.getByTestId('payment-result')).toHaveAttribute('data-view', 'not_found');
        await expect(page.getByRole('link', { name: 'Back to Bookplus' })).toBeVisible();
    });
});
