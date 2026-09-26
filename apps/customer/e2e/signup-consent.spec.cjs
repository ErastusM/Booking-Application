// Sign-up asks for the Terms/Privacy Policy AND the minimum age, and the API
// enforces both (compliance audit points 4 and 15). Covers the email sign-up
// (no Google) and the "Finish signing up" step a first-time Google sign-in
// now lands on before any account exists.
const { test, expect } = require('@playwright/test');

const API = `http://localhost:${process.env.E2E_API_PORT || 5052}`;
const unique = () => `e2e-signup-${Date.now()}-${Math.floor(Math.random() * 1e6)}@bookplus.dev`;

test('email sign-up needs the Terms and the age confirmation (no Google)', async ({ page }) => {
    const email = unique();
    await page.goto('/register');
    await page.getByRole('button', { name: /Book Services/i }).click();
    await page.getByPlaceholder('Ndapewa').fill('Ndapewa');
    await page.getByPlaceholder('Shilongo').fill('Shilongo');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('+264 81 234 5678').fill('+264811234567');
    await page.getByPlaceholder('••••••••').fill('Password1!');

    const create = page.getByRole('button', { name: /Create Account/i });
    const terms = page.getByRole('checkbox', { name: /Terms of Service and Privacy Policy/i });
    const age = page.getByTestId('register-age');
    const marketing = page.getByTestId('register-marketing-optin');

    // Every box starts unticked; the button waits for both required ones.
    await expect(terms).not.toBeChecked();
    await expect(age).not.toBeChecked();
    await expect(marketing).not.toBeChecked();
    await expect(page.getByText(/I am 16 or older/)).toBeVisible();
    await expect(create).toBeDisabled();
    await terms.check();
    await expect(create).toBeDisabled();
    await age.check();
    await expect(create).toBeEnabled();

    const reg = page.waitForRequest((r) => r.url().endsWith('/api/auth/register') && r.method() === 'POST');
    await create.click();
    const sent = JSON.parse((await reg).postData());
    expect(sent).toMatchObject({ termsAccepted: true, ageConfirmed: true, marketingOptIn: false });
    await expect(page.getByRole('heading', { name: /Check your email/i })).toBeVisible();
});

test('the API refuses a sign-up without the age confirmation', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/register`, {
        data: { name: 'No Age', email: unique(), password: 'Password1!', phone: '+264811234567', role: 'customer', termsAccepted: true },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('age_required');
});

test('first-time Google sign-in: no account until "Finish signing up" is completed', async ({ page, request }) => {
    const email = unique();
    const { code } = await (await request.post(`${API}/__e2e/google-pending`, { data: { email, name: 'Gina Google' } })).json();

    await page.goto(`/auth/callback?signup=${code}`);
    const form = page.getByTestId('finish-signup');
    await expect(form).toBeVisible();
    await expect(form).toContainText(email);
    // The one-time code is gone from the address bar.
    await expect(page).toHaveURL(/\/auth\/callback$/);
    await expect(form.getByRole('link', { name: 'Terms of Service' })).toBeVisible();
    await expect(form.getByRole('link', { name: 'Privacy Policy' })).toBeVisible();

    const createBtn = page.getByTestId('finish-create');
    await expect(createBtn).toBeDisabled();
    await page.getByTestId('finish-terms').check();
    await expect(createBtn).toBeDisabled();
    await page.getByTestId('finish-age').check();
    await createBtn.click();

    // Account created and signed in → the phone step for new Google accounts.
    await page.waitForURL(/\/complete-profile/, { timeout: 15_000 });
    const login = await request.post(`${API}/api/auth/google/complete`, { data: { code, termsAccepted: true, ageConfirmed: true } });
    expect((await login.json()).code).toBe('signup_expired'); // the code was single-use
});
