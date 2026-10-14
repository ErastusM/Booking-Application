import { isPublicTokenPath } from './http';

/**
 * Where to go after signing in, from a `?next=` the app put there itself (a
 * lapsed session goes to /login?error=session_expired&next=…, a flow that had to
 * interrupt the visitor sends them back where they were).
 *
 * `next` is attacker-controllable (anyone can mail a /login?next=… link), so
 * only a same-origin RELATIVE path is honoured: no scheme, no `//host`, no
 * backslash tricks (`/\evil.com` is `//evil.com` to a browser), no control
 * characters. Never back to /login itself or to an emailed-link page (their
 * one-time token is spent). Returns null when `raw` isn't safe to follow.
 */
export const safeNext = (
    raw: unknown,
    origin: string = typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
): string | null => {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    if (raw.includes('\\')) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
    let url: URL;
    try { url = new URL(raw, origin); } catch { return null; }
    if (url.origin !== new URL(origin).origin) return null;
    if (url.pathname === '/login' || isPublicTokenPath(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
};
