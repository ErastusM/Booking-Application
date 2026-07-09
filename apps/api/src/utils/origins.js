/**
 * CLIENT_URL doubles as the CORS allowlist and may be a comma-separated list
 * of origins. Redirects (Google OAuth, verify-email) and emailed links need
 * ONE canonical origin — the first entry, or an explicit PUBLIC_ORIGIN.
 * A comma-list used directly produced malformed URLs and broke Google login.
 */
const primaryOrigin = () =>
    (process.env.PUBLIC_ORIGIN || (process.env.CLIENT_URL || '').split(',')[0].trim() || '');

/**
 * The BUSINESS app origin (business.bookplus.pro). Auth redirects for
 * provider/staff/admin accounts must return HERE, not to the customer site —
 * otherwise a business signup lands on the wrong app. Resolved from an explicit
 * BUSINESS_ORIGIN, else the `business.*` entry in CLIENT_URL, else falls back to
 * the primary (customer) origin so nothing breaks if it isn't configured.
 */
const businessOrigin = () => {
    if (process.env.BUSINESS_ORIGIN) return process.env.BUSINESS_ORIGIN;
    const origins = (process.env.CLIENT_URL || '').split(',').map((o) => o.trim()).filter(Boolean);
    const biz = origins.find((o) => {
        try { return new URL(o).hostname.startsWith('business.'); } catch { return false; }
    });
    return biz || primaryOrigin();
};

/**
 * Which app a given account belongs to: customers use the customer site,
 * everyone else (provider/staff/admin) uses the business app.
 */
const originForRole = (role) => (role === 'customer' ? primaryOrigin() : businessOrigin());

module.exports = { primaryOrigin, businessOrigin, originForRole };
