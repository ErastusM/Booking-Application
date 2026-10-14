/**
 * Two-step sign-in for Bookplus admin accounts (authenticator-app codes, TOTP).
 * Money controls (utils/financeRoles.requireFinance) need a session that
 * passed it.
 *
 *  - The secret is stored encrypted (AES-256-GCM). The key is MFA_ENCRYPTION_KEY
 *    (32 bytes, hex or base64) or, when that isn't set, derived from JWT_SECRET.
 *  - A code is accepted once: the time step it belongs to is remembered, so a
 *    code seen over someone's shoulder can't be replayed.
 *  - Eight one-time recovery codes are given at setup; only their hashes are kept.
 */
const crypto = require('crypto');

const ISSUER = 'Bookplus';
const STEP_SECONDS = 30;
const TOLERANCE_SECONDS = 30; // accept the code before and after the current one (clock drift)

const key = () => {
    const raw = process.env.MFA_ENCRYPTION_KEY || '';
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    if (raw) {
        const b = Buffer.from(raw, 'base64');
        if (b.length === 32) return b;
    }
    return crypto.createHash('sha256').update(`bookplus-mfa:${process.env.JWT_SECRET || ''}`).digest();
};

const encrypt = (plain) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
};

const decrypt = (blob) => {
    const [iv, tag, data] = String(blob || '').split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
};

/* ── TOTP (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), the scheme every
   authenticator app uses. Node's crypto does the HMAC; this is only the
   counter and the digit extraction. ── */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Encode = (buf) => {
    let bits = 0; let value = 0; let out = '';
    for (const byte of buf) {
        value = (value << 8) | byte; bits += 8;
        while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
};
const base32Decode = (str) => {
    const clean = String(str || '').toUpperCase().replace(/[\s=]/g, '');
    let bits = 0; let value = 0; const out = [];
    for (const ch of clean) {
        const i = B32.indexOf(ch);
        if (i < 0) throw new Error('Invalid base32');
        value = (value << 5) | i; bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(out);
};
const DIGITS = 6;
/** The code for one time step (exported for the RFC test vectors). */
const totpAt = (secretBuf, step, digits = DIGITS) => {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const h = crypto.createHmac('sha1', secretBuf).update(counter).digest();
    const off = h[h.length - 1] & 0xf;
    const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
};
const generateSecret = () => base32Encode(crypto.randomBytes(20)); // 160 bits, as RFC 4226 recommends
const generateURI = ({ secret, label, issuer }) => {
    const l = encodeURIComponent(`${issuer}:${label}`);
    return `otpauth://totp/${l}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
};
/** The step a code matches within the tolerance, or null. Constant-time compare. */
const matchStep = (secret, token, nowMs = Date.now()) => {
    const key = base32Decode(secret);
    const now = Math.floor(nowMs / 1000 / STEP_SECONDS);
    const span = Math.ceil(TOLERANCE_SECONDS / STEP_SECONDS);
    let found = null;
    for (let d = -span; d <= span; d += 1) {
        const expected = Buffer.from(totpAt(key, now + d));
        if (crypto.timingSafeEqual(expected, Buffer.from(token)) && found === null) found = now + d;
    }
    return found;
};

const hashCode = (code) => crypto.createHash('sha256').update(String(code).replace(/[\s-]/g, '').toUpperCase()).digest('hex');

/** A fresh secret plus what the authenticator app needs to add it. */
const newSecret = (accountLabel) => {
    const secret = generateSecret();
    return { secret, secretEnc: encrypt(secret), otpauthUrl: generateURI({ secret, label: accountLabel, issuer: ISSUER }) };
};

const newRecoveryCodes = () => {
    const codes = Array.from({ length: 8 }, () => {
        const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 characters
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    return { codes, hashes: codes.map(hashCode) };
};

/**
 * Check a 6-digit code against an encrypted secret. Returns the time step it
 * matched (to remember, so it can't be used again) or null.
 */
const checkCode = (secretEnc, code, lastStep = null) => {
    const token = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(token) || !secretEnc) return null;
    let secret;
    try { secret = decrypt(secretEnc); } catch { return null; }
    let step;
    try { step = matchStep(secret, token); } catch { return null; }
    if (step === null) return null;
    if (Number.isFinite(lastStep) && step <= lastStep) return null; // already used
    return step;
};

/** Hours a confirmed session may use the money controls before asking again. */
const SESSION_HOURS = () => {
    const h = Number(process.env.MFA_SESSION_HOURS);
    return Number.isFinite(h) && h > 0 ? h : 12;
};

/** Did this session pass two-step sign-in recently enough? (token claims) */
const sessionFresh = (claims) => !!claims && claims.mfa === true && Number.isFinite(claims.mfaAt)
    && (Date.now() / 1000 - claims.mfaAt) < SESSION_HOURS() * 3600;

/** Use up a recovery code: returns the remaining hashes, or null if it didn't match. */
const useRecoveryCode = (hashes, code) => {
    const h = hashCode(code);
    const list = Array.isArray(hashes) ? hashes : [];
    if (!list.includes(h)) return null;
    return list.filter((x) => x !== h);
};

module.exports = { totpAt, base32Encode, base32Decode, newSecret, newRecoveryCodes, checkCode, useRecoveryCode, encrypt, decrypt, hashCode, sessionFresh, SESSION_HOURS };
