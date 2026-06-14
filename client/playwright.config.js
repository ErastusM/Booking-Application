// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const CLIENT_PORT = process.env.E2E_CLIENT_PORT || 3100;
const API_PORT = process.env.E2E_API_PORT || 5050;
const BASE_URL = `http://localhost:${CLIENT_PORT}`;

/**
 * E2E config. Boots a self-contained API (in-memory Mongo) and the CRA
 * dev server, then runs the specs in client/e2e against a real browser.
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
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: [
        {
            command: 'npm run e2e:server',
            cwd: '../server',
            port: Number(API_PORT),
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: { PORT: String(API_PORT), CLIENT_URL: BASE_URL },
        },
        {
            command: 'npm start',
            port: Number(CLIENT_PORT),
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
            env: {
                PORT: String(CLIENT_PORT),
                BROWSER: 'none',
                // api.js appends "/api", so the base must NOT include it
                REACT_APP_API_URL: `http://localhost:${API_PORT}`,
            },
        },
    ],
});
