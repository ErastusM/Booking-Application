// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const BUSINESS_PORT = process.env.E2E_BUSINESS_PORT || 3103;
const CUSTOMER_PORT = process.env.E2E_CUSTOMER_PORT || 3104;
const API_PORT = process.env.E2E_API_PORT || 5053;
const BASE_URL = `http://localhost:${BUSINESS_PORT}`;
const CUSTOMER_URL = `http://localhost:${CUSTOMER_PORT}`;

/**
 * E2E config for the business app, including CROSS-APP scenarios: it boots
 * the self-contained API (in-memory Mongo) plus BOTH Vite apps, so specs can
 * verify the shared-cookie SSO hand-off between customer and business sides.
 * Ports are distinct from apps/customer's e2e (5052/3102) so both suites can
 * run back-to-back without stealing each other's servers.
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
            origins: [BASE_URL, CUSTOMER_URL].map((origin) => ({
                origin,
                localStorage: [{ name: 'bp_consent', value: JSON.stringify({ v: 1, analytics: false, at: '2026-01-01T00:00:00.000Z' }) }],
            })),
        },
        // Sandboxed containers often pre-install one Chromium at a fixed path
        // instead of the exact build this @playwright/test version downloads.
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
            // CLIENT_URL is a comma-separated CORS allowlist — both app origins.
            // Online payments on for the API (no seeded business is approved,
            // so nothing else asks for payment) with a stand-in Cloudinary
            // account (the browser's uploads to it are intercepted in the spec)
            // and a stand-in PayGate (E2E_FAKE_PAYGATE).
            env: {
                PORT: String(API_PORT), CLIENT_URL: `${BASE_URL},${CUSTOMER_URL}`,
                PAYMENTS_ENABLED: 'true', CLOUDINARY_URL: 'cloudinary://e2ekey:e2esecret@e2e-cloud',
                E2E_FAKE_PAYGATE: '1', PAYGATE_CALLBACK_BASE_URL: `http://localhost:${API_PORT}`, CUSTOMER_APP_URL: CUSTOMER_URL,
            },
        },
        {
            command: `npx vite --port ${BUSINESS_PORT} --strictPort`,
            port: Number(BUSINESS_PORT),
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: {
                VITE_API_URL: `http://localhost:${API_PORT}`,
                VITE_CUSTOMER_URL: CUSTOMER_URL,
                // Shows Account → Online payments before the feature is switched on.
                VITE_PAYMENTS_PREVIEW: 'true',
            },
        },
        {
            command: `npx vite --port ${CUSTOMER_PORT} --strictPort`,
            cwd: '../customer',
            port: Number(CUSTOMER_PORT),
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: {
                VITE_API_URL: `http://localhost:${API_PORT}`,
                VITE_BUSINESS_URL: BASE_URL,
            },
        },
    ],
});
