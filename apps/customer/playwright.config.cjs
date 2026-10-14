// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const CLIENT_PORT = process.env.E2E_CLIENT_PORT || 3102;
const API_PORT = process.env.E2E_API_PORT || 5052;
const BASE_URL = `http://localhost:${CLIENT_PORT}`;

/**
 * E2E config for the customer app (moved here when the legacy CRA client
 * retired). Boots a self-contained API (in-memory Mongo) and the Vite dev
 * server, then runs the specs in ./e2e against a real browser.
 */
module.exports = defineConfig({
    testDir: './e2e',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        // Every spec starts with the cookie choice already made ("Only
        // necessary"), so the consent banner never sits over the controls a
        // spec is driving. consent.spec.cjs clears this to test the banner itself.
        storageState: {
            cookies: [],
            origins: [{
                origin: BASE_URL,
                localStorage: [{ name: 'bp_consent', value: JSON.stringify({ v: 1, analytics: false, at: '2026-01-01T00:00:00.000Z' }) }],
            }],
        },
        // Sandboxed containers often pre-install one Chromium at a fixed path
        // instead of the exact build this @playwright/test version downloads
        // (same switch as apps/business/playwright.config.cjs).
        ...(process.env.PW_EXECUTABLE_PATH
            ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } }
            : {}),
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: [
        {
            command: 'npm run e2e:server',
            cwd: '../api',
            port: Number(API_PORT),
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            // Online payments on, against a stand-in PayGate (E2E_FAKE_PAYGATE):
            // only the fixture business that asks for payment is affected.
            env: {
                PORT: String(API_PORT), CLIENT_URL: BASE_URL,
                PAYMENTS_ENABLED: 'true', E2E_FAKE_PAYGATE: '1',
                PAYGATE_CALLBACK_BASE_URL: `http://localhost:${API_PORT}`, CUSTOMER_APP_URL: BASE_URL,
            },
        },
        {
            command: `npx vite --port ${CLIENT_PORT} --strictPort`,
            port: Number(CLIENT_PORT),
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: {
                // The api-client appends /api itself — origin only.
                VITE_API_URL: `http://localhost:${API_PORT}`,
                // Shows the pay-online parts before the feature is switched on.
                VITE_PAYMENTS_PREVIEW: 'true',
            },
        },
    ],
});
