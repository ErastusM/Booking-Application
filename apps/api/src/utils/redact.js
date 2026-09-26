/**
 * Strip secrets out of URLs and free text before they reach a log line, Sentry,
 * the Slack/Discord alert webhook or the analytics table.
 *
 * Every emailed link in Bookplus is a bearer credential: /reset-password?token=,
 * /accept-invite?token=, /verify-email?token=, /auth/callback?code= and the
 * guest /manage/<token> path. Anything that captures "the URL the user was on"
 * — the crash reporter, Sentry's request context, a page_view — would otherwise
 * copy those credentials to places many more people can read.
 *
 * The rules (mirrored in packages/api-client/src/redact.ts for the browser; the
 * two share test vectors):
 *   - every query-string VALUE and the #fragment are replaced with [redacted]
 *     (the keys stay, so a report still says which page and which flow);
 *   - known token-bearing path segments are replaced with their route template
 *     (/manage/:token, /staff-invite/:token);
 *   - any other path segment that looks like a secret (a UUID, or 32+ hex/base64
 *     characters) becomes :token. 24-hex Mongo ids are left alone — they name
 *     public things (a provider profile) and are not credentials.
 */

const REDACTED = '[redacted]';

// /manage/<token>[/cancel|/reschedule], /staff-invite/<token>[/accept|/renew],
// /unsubscribe/<token> (marketing-email opt-out links).
// `staff-invite/request` is a real route, not a token.
const TOKEN_ROUTES = [
    { re: /(\/manage\/)[^/?#]+/gi, keep: '$1:token' },
    { re: /(\/staff-invite\/)(?!request(?:[/?#]|$))[^/?#]+/gi, keep: '$1:token' },
    { re: /(\/unsubscribe\/)[^/?#]+/gi, keep: '$1:token' },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_SECRET = /^[A-Za-z0-9_-]{32,}$/;

const scrubPath = (path) => {
    if (typeof path !== 'string' || !path) return path || '';
    let out = path;
    for (const { re, keep } of TOKEN_ROUTES) out = out.replace(re, keep);
    return out
        .split('/')
        .map((seg) => (UUID.test(seg) || LONG_SECRET.test(seg) ? ':token' : seg))
        .join('/');
};

const scrubQuery = (query) => {
    if (!query) return '';
    const parts = query.replace(/^\?/, '').split('&').filter(Boolean);
    if (!parts.length) return '';
    return `?${parts.map((p) => `${p.split('=')[0]}=${REDACTED}`).join('&')}`;
};

/** Scrub one URL (absolute or a bare path). Never throws. */
const scrubUrl = (url) => {
    if (typeof url !== 'string' || !url) return '';
    try {
        const hashAt = url.indexOf('#');
        const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
        const qAt = noHash.indexOf('?');
        const base = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
        const query = qAt >= 0 ? noHash.slice(qAt) : '';
        // Keep scheme://host intact; scrub only the path.
        const m = base.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)(.*)$/i);
        const scrubbedBase = m ? m[1] + scrubPath(m[2]) : scrubPath(base);
        return scrubbedBase + scrubQuery(query) + (hashAt >= 0 ? `#${REDACTED}` : '');
    } catch {
        return REDACTED;
    }
};

// URLs and bare /paths embedded in free text (an error message, a stack trace).
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
const PATH_IN_TEXT = /(^|[\s"'(=])(\/[A-Za-z0-9._~%!$&'*+,;=:@/-]*\?[^\s"'<>)\]]*|\/(?:manage|staff-invite|unsubscribe)\/[^\s"'<>)\]]+)/g;
// token=… / code=… style pairs left over anywhere else.
const SECRET_PAIR = /\b(token|code|signup|secret|password|pass|sig|signature|state|key|apikey|api_key|access_token|refresh_token|refreshToken|redeem)=([^&\s"'<>]+)/gi;

/** Scrub every URL and secret-looking key=value pair inside free text. */
const scrubText = (text) => {
    if (typeof text !== 'string' || !text) return text || '';
    return text
        .replace(URL_IN_TEXT, (u) => scrubUrl(u))
        .replace(PATH_IN_TEXT, (all, lead, p) => lead + scrubUrl(p))
        .replace(SECRET_PAIR, (all, k) => `${k}=${REDACTED}`);
};

module.exports = { scrubUrl, scrubPath, scrubText, REDACTED };
