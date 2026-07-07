// Shared helpers + seeded credentials for the business-app E2E specs.
// Accounts are created by apps/api/e2e-server.js on boot.
const SEED = {
    customer: { email: 'e2e-customer@bookplus.dev', password: 'Password1!' },
    provider: { email: 'e2e-provider@bookplus.dev', password: 'Password1!' },
    providerName: 'E2E Provider',
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

module.exports = { SEED, login, CUSTOMER_URL };
