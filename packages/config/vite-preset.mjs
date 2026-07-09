import react from '@vitejs/plugin-react';

/**
 * Shared Vite config for the Bookplus apps (customer + business).
 * Local port conventions: 3002 customer, 3003 business — 3000/3001/5000/5050
 * are taken by the legacy client, other stacks, and the API.
 */
export const makeViteConfig = ({ port }) => {
    // One id per build. Baked into the bundle as __BUILD_ID__ AND written to
    // dist/version.json, so the running app can poll version.json and notice when
    // a newer build has been deployed (auto-refresh, no manual reload needed).
    const buildId = String(Date.now());
    return {
        plugins: [
            react(),
            {
                name: 'bookplus-version-json',
                apply: 'build',
                generateBundle() {
                    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) });
                },
            },
        ],
        define: { __BUILD_ID__: JSON.stringify(buildId) },
        server: { port, strictPort: true },
        preview: { port, strictPort: true },
        build: { outDir: 'dist', sourcemap: false },
    };
};
