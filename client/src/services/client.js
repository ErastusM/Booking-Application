import { createBookplusClient } from '@bookplus/api-client';

// The one client instance the whole app shares. CRA substitutes
// process.env.REACT_APP_* reliably only in app source (not inside
// node_modules), so the env override is resolved here and passed in.
const client = createBookplusClient({ apiUrl: process.env.REACT_APP_API_URL });

export default client;
