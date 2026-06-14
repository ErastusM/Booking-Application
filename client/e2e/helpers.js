// Shared helpers + seeded credentials for E2E specs.
// These accounts are created by server/e2e-server.js on boot.
const SEED = {
    customer: { email: 'e2e-customer@bookplus.invalid', password: 'Password1!' },
    provider: { email: 'e2e-provider@bookplus.invalid', password: 'Password1!' },
    serviceName: 'E2E Haircut',
    providerName: 'E2E Barber',
};

async function login(page, { email, password }) {
    await page.goto('/login');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    // Wait until we navigate away from the login screen
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
}

module.exports = { SEED, login };
