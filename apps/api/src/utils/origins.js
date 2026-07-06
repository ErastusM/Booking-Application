/**
 * CLIENT_URL doubles as the CORS allowlist and may be a comma-separated list
 * of origins. Redirects (Google OAuth, verify-email) and emailed links need
 * ONE canonical origin — the first entry, or an explicit PUBLIC_ORIGIN.
 * A comma-list used directly produced malformed URLs and broke Google login.
 */
const primaryOrigin = () =>
    (process.env.PUBLIC_ORIGIN || (process.env.CLIENT_URL || '').split(',')[0].trim() || '');

module.exports = { primaryOrigin };
