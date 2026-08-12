import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Unit and component tests for the business app.
 *
 * This exists because of a specific, repeated failure: several real defects
 * shipped that a build could never catch — a switch whose track swallowed
 * every click, cards that selected text instead of being dragged, a panel
 * reading data only another tab fetched, a commit run inside a setState
 * updater (which React calls twice under StrictMode), and a swap planner that
 * proposed overlapping bookings. Every one of them compiled cleanly. The API
 * suite cannot see any of them, and Playwright is too slow and too coarse to
 * pin the arithmetic.
 *
 * Scope, deliberately: the PURE planners and the small interactive pieces.
 * Whole-page tests belong to the e2e suite, which already boots a real API.
 */
export default defineConfig({
    plugins: [react()],
    test: {
        // jsdom by default so component tests just work; the pure planner tests
        // don't care and cost nothing extra.
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.js'],
        include: ['src/**/*.{test,spec}.{js,jsx}'],
        // e2e lives in ./e2e and is driven by Playwright, not this runner.
        exclude: ['e2e/**', 'node_modules/**'],
        restoreMocks: true,
    },
});
