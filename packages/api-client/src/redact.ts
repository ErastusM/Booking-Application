// Browser copy of apps/api/src/utils/redact.js — keep the two in step (they are
// tested against the same vectors: apps/api/src/tests/fixtures/redactVectors.json).
//
// Every emailed link in Bookplus is a bearer credential (/reset-password?token=,
// /accept-invite?token=, /verify-email, /auth/callback?code=, /manage/<token>,
// /unsubscribe/<token>). Crash reports and analytics must never copy them:
//   - every query-string VALUE and the #fragment become [redacted];
//   - token-bearing path segments become their route template (/manage/:token);
//   - any other UUID or 32+ char token-looking segment becomes :token.

export const REDACTED = '[redacted]';

const TOKEN_ROUTES: Array<[RegExp, string]> = [
    [/(\/manage\/)[^/?#]+/gi, '$1:token'],
    [/(\/staff-invite\/)(?!request(?:[/?#]|$))[^/?#]+/gi, '$1:token'],
    [/(\/unsubscribe\/)[^/?#]+/gi, '$1:token'],
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_SECRET = /^[A-Za-z0-9_-]{32,}$/;

export function scrubPath(path: string): string {
    if (typeof path !== 'string' || !path) return '';
    let out = path;
    for (const [re, keep] of TOKEN_ROUTES) out = out.replace(re, keep);
    return out
        .split('/')
        .map((seg) => (UUID.test(seg) || LONG_SECRET.test(seg) ? ':token' : seg))
        .join('/');
}

function scrubQuery(query: string): string {
    if (!query) return '';
    const parts = query.replace(/^\?/, '').split('&').filter(Boolean);
    if (!parts.length) return '';
    return `?${parts.map((p) => `${p.split('=')[0]}=${REDACTED}`).join('&')}`;
}

/** Scrub one URL (absolute or a bare path). Never throws. */
export function scrubUrl(url: unknown): string {
    if (typeof url !== 'string' || !url) return '';
    try {
        const hashAt = url.indexOf('#');
        const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
        const qAt = noHash.indexOf('?');
        const base = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
        const query = qAt >= 0 ? noHash.slice(qAt) : '';
        const m = base.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)(.*)$/i);
        const scrubbedBase = m ? m[1] + scrubPath(m[2]) : scrubPath(base);
        return scrubbedBase + scrubQuery(query) + (hashAt >= 0 ? `#${REDACTED}` : '');
    } catch {
        return REDACTED;
    }
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
const PATH_IN_TEXT = /(^|[\s"'(=])(\/[A-Za-z0-9._~%!$&'*+,;=:@/-]*\?[^\s"'<>)\]]*|\/(?:manage|staff-invite|unsubscribe)\/[^\s"'<>)\]]+)/g;
const SECRET_PAIR = /\b(token|code|signup|secret|password|pass|sig|signature|state|key|apikey|api_key|access_token|refresh_token|refreshToken|redeem)=([^&\s"'<>]+)/gi;

/** Scrub every URL and secret-looking key=value pair inside free text. */
export function scrubText(text: unknown): string {
    if (typeof text !== 'string' || !text) return '';
    return text
        .replace(URL_IN_TEXT, (u) => scrubUrl(u))
        .replace(PATH_IN_TEXT, (_all, lead, p) => lead + scrubUrl(p))
        .replace(SECRET_PAIR, (_all, k) => `${k}=${REDACTED}`);
}

/**
 * The route template an analytics event records for a pathname — the path with
 * every credential replaced, and never a query string.
 */
export function routeTemplate(pathname: unknown): string {
    if (typeof pathname !== 'string' || !pathname) return '';
    return scrubPath(pathname.split(/[?#]/)[0]);
}
