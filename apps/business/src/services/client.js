import { createBookplusClient } from '@bookplus/api-client';

// One client per app. Vite injects VITE_API_URL at build time; without it the
// api-client falls back to its hostname inference (same rules as the web app).
const client = createBookplusClient({ apiUrl: import.meta.env.VITE_API_URL });

export default client;
