/**
 * Server-side Cloudinary access for PRIVATE files (bank proof-of-payment).
 *
 * The apps upload avatars and portfolio photos unsigned to public URLs — fine for
 * pictures meant to be seen. A proof of payment is a bank document: it must never
 * sit at a guessable public URL. So proofs are uploaded as `type: authenticated`
 * (no public delivery at all) with a signature only this server can make, and
 * are shown through short-lived signed download links minted per request, only
 * for the people entitled to see that proof.
 *
 * No SDK dependency: the few calls needed are plain signed HTTPS requests
 * (https://cloudinary.com/documentation/authentication_signatures).
 *
 * Configuration — either CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>, or
 * CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET. Without it
 * private uploads are unavailable (isConfigured() is false) and callers say so.
 */
const crypto = require('crypto');

const PROOF_FOLDER = 'bookplus/proofs';
const PROOF_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'pdf'];
const PROOF_TYPE = 'authenticated';
// How long a signed proof link works. Long enough to open it, short enough that a
// forwarded or logged link is dead almost at once.
const PROOF_LINK_SECONDS = 5 * 60;

const config = () => {
    const url = process.env.CLOUDINARY_URL;
    if (url) {
        const m = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
        if (m) return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] };
    }
    return {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
        apiKey: process.env.CLOUDINARY_API_KEY || '',
        apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    };
};

const isConfigured = () => {
    const c = config();
    return Boolean(c.cloudName && c.apiKey && c.apiSecret);
};

/** Cloudinary API signature: sha1 of the sorted, &-joined params + secret. */
const signParams = (params, apiSecret = config().apiSecret) => {
    const toSign = Object.keys(params)
        .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
        .sort()
        .map((k) => `${k}=${Array.isArray(params[k]) ? params[k].join(',') : params[k]}`)
        .join('&');
    return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Parameters the browser needs to upload ONE proof straight to Cloudinary as an
 * authenticated asset in this user's own folder. Everything that matters (type,
 * folder, allowed formats) is covered by the signature, so the browser cannot
 * change it into a public upload or drop the file somewhere else.
 */
const proofUploadParams = (userId) => {
    const c = config();
    const params = {
        timestamp: nowSeconds(),
        type: PROOF_TYPE,
        folder: `${PROOF_FOLDER}/${userId}`,
        allowed_formats: PROOF_FORMATS.join(','),
    };
    return {
        cloudName: c.cloudName,
        apiKey: c.apiKey,
        uploadUrl: `https://api.cloudinary.com/v1_1/${c.cloudName}/auto/upload`,
        ...params,
        signature: signParams(params, c.apiSecret),
    };
};

/**
 * Validate what the browser reports back after its upload. Only a file in the
 * uploader's own proof folder, of an allowed kind, is accepted — so nobody can
 * attach someone else's proof (or an arbitrary public URL) to their top-up.
 */
const cleanProofRef = (ref, userId) => {
    if (!ref || typeof ref !== 'object') return null;
    const publicId = typeof ref.publicId === 'string' ? ref.publicId : '';
    const resourceType = ref.resourceType === 'raw' ? 'raw' : ref.resourceType === 'image' ? 'image' : null;
    const format = typeof ref.format === 'string' ? ref.format.toLowerCase() : '';
    if (!resourceType || !publicId || publicId.length > 300) return null;
    if (!publicId.startsWith(`${PROOF_FOLDER}/${userId}/`)) return null;
    if (!/^[A-Za-z0-9_\-/.]+$/.test(publicId) || publicId.includes('..')) return null;
    if (format && !PROOF_FORMATS.includes(format)) return null;
    return { publicId, resourceType, format, deliveryType: PROOF_TYPE };
};

/**
 * A short-lived, signed download link for a private/authenticated asset (the
 * Cloudinary "private download URL"). It stops working after `seconds`.
 */
const privateDownloadUrl = ({ publicId, format, resourceType = 'image', type = PROOF_TYPE }, seconds = PROOF_LINK_SECONDS) => {
    const c = config();
    const now = nowSeconds();
    const params = {
        public_id: publicId,
        format: format || undefined,
        type,
        expires_at: now + seconds,
        timestamp: now,
    };
    const signature = signParams(params, c.apiSecret);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    qs.set('api_key', c.apiKey);
    qs.set('signature', signature);
    return `https://api.cloudinary.com/v1_1/${c.cloudName}/${resourceType}/download?${qs.toString()}`;
};

/**
 * Split a Cloudinary delivery URL into its parts, e.g.
 *   https://res.cloudinary.com/<cloud>/image/upload/v1712/folder/abc.jpg
 *   → { cloudName, resourceType:'image', type:'upload', publicId:'folder/abc', format:'jpg' }
 * Raw files keep their extension in the public id. Returns null if it isn't one.
 */
const parseDeliveryUrl = (url) => {
    if (typeof url !== 'string') return null;
    const m = url.match(/^https?:\/\/res\.cloudinary\.com\/([^/]+)\/(image|raw|video)\/(upload|private|authenticated)\/(?:s--[^/]+--\/)?(?:v\d+\/)?(.+)$/);
    if (!m) return null;
    const [, cloudName, resourceType, type, rest] = m;
    const path = decodeURIComponent(rest.split('?')[0]);
    if (resourceType === 'raw') return { cloudName, resourceType, type, publicId: path, format: '' };
    const dot = path.lastIndexOf('.');
    return dot > 0
        ? { cloudName, resourceType, type, publicId: path.slice(0, dot), format: path.slice(dot + 1).toLowerCase() }
        : { cloudName, resourceType, type, publicId: path, format: '' };
};

const signedPost = async (path, params) => {
    const c = config();
    const body = { ...params, timestamp: nowSeconds() };
    body.signature = signParams(body, c.apiSecret);
    body.api_key = c.apiKey;
    const res = await fetch(`https://api.cloudinary.com/v1_1/${c.cloudName}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString(),
        signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
};

/**
 * Move an existing PUBLIC asset to authenticated delivery (same public id), and
 * purge the CDN copy so the old public URL dies too.
 */
const makeAuthenticated = ({ publicId, resourceType = 'image', fromType = 'upload' }) =>
    signedPost(`${resourceType}/rename`, {
        from_public_id: publicId,
        to_public_id: publicId,
        type: fromType,
        to_type: PROOF_TYPE,
        invalidate: 'true',
    });

/** Does an asset exist with this delivery type? (Admin API, basic auth.) */
const assetExists = async ({ publicId, resourceType = 'image', type = PROOF_TYPE }) => {
    const c = config();
    const res = await fetch(
        `https://api.cloudinary.com/v1_1/${c.cloudName}/resources/${resourceType}/${type}/${encodeURIComponent(publicId).replace(/%2F/g, '/')}`,
        {
            headers: { Authorization: `Basic ${Buffer.from(`${c.apiKey}:${c.apiSecret}`).toString('base64')}` },
            signal: AbortSignal.timeout(20000),
        },
    );
    return res.ok;
};

/** Delete one asset (best effort, e.g. on account deletion). */
const destroy = ({ publicId, resourceType = 'image', type = 'upload' }) =>
    signedPost(`${resourceType}/destroy`, { public_id: publicId, type, invalidate: 'true' });

module.exports = {
    PROOF_FOLDER,
    PROOF_FORMATS,
    PROOF_TYPE,
    PROOF_LINK_SECONDS,
    config,
    isConfigured,
    signParams,
    proofUploadParams,
    cleanProofRef,
    privateDownloadUrl,
    parseDeliveryUrl,
    makeAuthenticated,
    assetExists,
    destroy,
};
