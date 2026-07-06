import react from '@vitejs/plugin-react';

/**
 * Shared Vite config for the Bookplus apps (customer + business).
 * Local port conventions: 3002 customer, 3003 business — 3000/3001/5000/5050
 * are taken by the legacy client, other stacks, and the API.
 */
export const makeViteConfig = ({ port }) => ({
    plugins: [react()],
    server: { port, strictPort: true },
    preview: { port, strictPort: true },
    build: { outDir: 'dist', sourcemap: false },
});
