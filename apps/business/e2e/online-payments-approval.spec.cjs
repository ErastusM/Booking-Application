const { test, expect } = require('@playwright/test');
const { login, adminWithTwoStep, adminConsoleLogin, adminSection } = require('./helpers.cjs');

const API = `http://localhost:${process.env.E2E_API_PORT || 5053}`;

/**
 * A business applies to take online payments and Bookplus approves it, in the
 * browser end to end: plan, details, documents (the private upload to
 * Cloudinary is intercepted), bank account, terms, send; an admin with
 * two-step sign-in reviews and approves it; the business switches online
 * payments on. Account → Online payments is shown by VITE_PAYMENTS_PREVIEW
 * until the feature is switched on for everyone.
 */
test.describe('Online payments: apply and approve', () => {
    test('a business applies, an admin approves it, the business switches it on', async ({ page, browser, request }) => {
        test.setTimeout(120_000);
        const fx = await (await request.post(`${API}/__e2e/admin-fixture`)).json();

        // The browser uploads straight to Cloudinary with the API's signature;
        // answer as Cloudinary would, inside this business's own folder.
        let n = 0;
        await page.route('https://api.cloudinary.com/v1_1/**', async (route) => {
            n += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ public_id: `bookplus/verification/${fx.providerId}/doc-${n}`, resource_type: 'image', format: 'pdf' }),
            });
        });

        await page.setViewportSize({ width: 390, height: 844 });
        await login(page, { email: fx.ownerEmail, password: 'Password1!' });
        await page.goto('/account?section=payments');
        const section = page.getByTestId('online-payments');
        await expect(section).toBeVisible();
        await expect(page.getByTestId('application-status')).toContainText('Not sent yet');

        // 1. Plan: every cost is on the card.
        const standard = page.getByTestId('plan-standard');
        await expect(standard).toContainText('No monthly fee');
        await expect(standard).toContainText('3% + N$1.50');
        await standard.getByRole('radio').click();
        await expect(standard.getByRole('radio')).toBeChecked();

        // 2. Details.
        await page.getByLabel('What kind of business is it?').selectOption('cc');
        await page.getByLabel('Registered business name').fill('Admin Fixture Salon CC');
        await page.getByLabel('Registration number').fill('CC/2021/01234');
        await page.getByLabel("Owner's full name").fill('Fixture Owner');
        await page.getByLabel("Owner's ID or passport number").fill('85010100123');
        await page.getByRole('button', { name: 'Save details' }).click();
        await expect(page.getByTestId('id-saved')).toHaveText(/^Saved: •+123$/);
        await expect(page.getByLabel("Owner's ID or passport number")).toHaveValue('');

        // 3. Documents (private upload).
        const pdf = { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') };
        for (const kind of ['owner_id', 'registration', 'bank_letter']) {
            await page.locator(`#file-${kind}`).setInputFiles({ ...pdf, name: `${kind}.pdf` });
            await expect(page.getByTestId(`doc-${kind}`)).toContainText(`${kind}.pdf`);
        }

        // 4. Bank account.
        await page.getByLabel('Account holder').fill('Admin Fixture Salon CC');
        await page.getByLabel('Bank', { exact: true }).fill('Bank Windhoek');
        await page.getByLabel('Branch code').fill('483872');
        await page.getByLabel('Account number').fill('80041234821');
        await page.getByRole('button', { name: 'Save bank account' }).click();
        await expect(section).toContainText('•••• 4821');

        // The page never scrolls sideways on a phone.
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

        // 5. Send, with the terms accepted.
        const send = page.getByTestId('send-application');
        await expect(send).toContainText('Everything is in');
        await send.getByRole('checkbox').check();
        await send.getByRole('button', { name: 'Send application' }).click();
        await expect(page.getByTestId('application-status')).toContainText('With Bookplus');

        // Bookplus reviews it.
        const admin = await adminWithTwoStep(request);
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();
        await adminConsoleLogin(adminPage, admin);
        await adminSection(adminPage, 'Approvals');
        const row = adminPage.getByTestId('approval-row').filter({ hasText: fx.businessName });
        await expect(row).toContainText('Waiting for review');
        await row.getByRole('button', { name: 'Review' }).click();
        const review = adminPage.getByTestId('application-review');
        await expect(review).toContainText('85010100123');
        await expect(review).toContainText('80041234821');
        await review.getByRole('button', { name: 'Approve' }).click();
        // It leaves the queue, and is listed under Approved.
        await expect(row).toHaveCount(0);
        await adminPage.getByTestId('business-approvals').getByLabel('Show').selectOption('approved');
        const approved = adminPage.getByTestId('approval-row').filter({ hasText: fx.businessName });
        await expect(approved).toContainText('Approved, standard');
        await adminContext.close();

        // The business sees it and switches online payments on.
        await page.reload();
        await expect(page.getByTestId('application-status')).toContainText('Approved');
        const sw = page.getByTestId('payments-switch');
        await sw.evaluate((el) => el.scrollIntoView({ block: 'center' })); // clear of the bottom bar
        await sw.getByRole('checkbox').click();
        await expect(sw.getByRole('checkbox')).toBeChecked();
        await expect(sw.getByTestId('switch-label')).toContainText('nothing is asked online yet');

        // A 25% deposit: now a N$200 booking asks for N$50 online.
        const mode = sw.getByTestId('payment-mode');
        await mode.getByRole('radio', { name: /A deposit when they book/ }).check();
        await mode.getByLabel('Percent of the price').fill('25');
        await mode.getByRole('button', { name: 'Save' }).click();
        await expect(sw.getByTestId('switch-label')).toContainText('On: clients pay a deposit of 25% of the price when they book');
        const policy = await (await request.get(`${API}/api/payments/policy/${fx.providerId}?priceCents=20000`)).json();
        expect(policy.data).toMatchObject({ onlinePayment: true, mode: 'deposit', amountDueOnlineCents: 5000 });
    });
});
