import { createBookplusClient } from '@bookplus/api-client';

// One client per app. Vite injects VITE_API_URL at build time; without it the
// api-client falls back to its hostname inference (same rules as the web app).
// accountType scopes auth (login/refresh/SSO) to customer accounts — an email
// that also holds a business account signs in HERE as its customer account.
const client = createBookplusClient({ apiUrl: import.meta.env.VITE_API_URL, accountType: 'customer' });

export default client;
