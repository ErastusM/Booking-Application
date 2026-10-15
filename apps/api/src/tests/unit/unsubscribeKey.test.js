/**
 * Unsubscribe links never expire. Until UNSUBSCRIBE_KEY is set they are signed
 * with a key derived from JWT_SECRET, and production's JWT_SECRET was public.
 * When JWT_SECRET is rotated (docs/ROTATING_SECRETS.md) that derived key moves
 * to UNSUBSCRIBE_KEY_LEGACY: links already emailed can still unsubscribe, but
 * nothing signed with it can switch email back on; new links use a fresh key.
 */
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { unsubscribeKey, derivedKey, makeUnsubscribeToken, readUnsubscribeToken } = require('../../utils/marketing');

const ORIGINAL = process.env.JWT_SECRET;
afterEach(() => {
    process.env.JWT_SECRET = ORIGINAL;
    delete process.env.UNSUBSCRIBE_KEY;
    delete process.env.UNSUBSCRIBE_KEY_LEGACY;
});
const rotate = () => {
    const legacy = derivedKey().toString('hex');
    process.env.JWT_SECRET = 'a-brand-new-jwt-secret-0123456789abcdef0123456789';
    process.env.UNSUBSCRIBE_KEY_LEGACY = legacy;
    process.env.UNSUBSCRIBE_KEY = crypto.randomBytes(32).toString('hex');
};
// What anyone holding the old, public JWT_SECRET can make.
const forgeWithOldSecret = (secret, payload) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const k = crypto.createHash('sha256').update(`bookplus-unsubscribe:${secret}`).digest();
    return `${body}.${crypto.createHmac('sha256', k).update(body).digest('base64url').slice(0, 32)}`;
};

describe('unsubscribe keys across a JWT_SECRET rotation', () => {
    it('a link emailed before can still unsubscribe, but can never resubscribe', () => {
        const link = makeUnsubscribeToken({ email: 'jane@example.com' });
        rotate();
        expect(readUnsubscribeToken(link, { optOut: true })).toEqual({ email: 'jane@example.com', legacy: true });
        expect(readUnsubscribeToken(link)).toBeNull();
    });

    it('a link forged with the old public JWT_SECRET cannot switch anyone back on', () => {
        rotate();
        const forged = forgeWithOldSecret(ORIGINAL, { k: 'g', e: 'victim@example.com' });
        expect(readUnsubscribeToken(forged)).toBeNull();
    });

    it('new links use the fresh UNSUBSCRIBE_KEY and work both ways', () => {
        rotate();
        expect(unsubscribeKey().toString('hex')).toBe(process.env.UNSUBSCRIBE_KEY);
        const link = makeUnsubscribeToken({ email: 'jane@example.com' });
        expect(readUnsubscribeToken(link)).toEqual({ email: 'jane@example.com' });
        expect(readUnsubscribeToken(link, { optOut: true })).toEqual({ email: 'jane@example.com' });
        // Not derivable from either JWT_SECRET.
        expect(readUnsubscribeToken(forgeWithOldSecret(process.env.JWT_SECRET, { k: 'g', e: 'jane@example.com' }), { optOut: true })).toBeNull();
    });

    it('without the legacy key, rotating JWT_SECRET would break every link already emailed', () => {
        const link = makeUnsubscribeToken({ email: 'jane@example.com' });
        process.env.JWT_SECRET = 'a-brand-new-jwt-secret-0123456789abcdef0123456789';
        expect(readUnsubscribeToken(link, { optOut: true })).toBeNull();
    });

    it('a signature with non-ASCII characters is refused, not an error', () => {
        const [body] = makeUnsubscribeToken({ email: 'jane@example.com' }).split('.');
        expect(readUnsubscribeToken(`${body}.${'é'.repeat(32)}`, { optOut: true })).toBeNull();
    });
});

describe('scripts (as the runbook runs them)', () => {
    const dir = path.join(__dirname, '../../../scripts');
    // A clean environment, run outside the repo so no .env file is read.
    const run = (script, env, ...args) => spawnSync(process.execPath, [path.join(dir, script), ...args], {
        cwd: os.tmpdir(), encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
    });
    const OLD = { JWT_SECRET: 'the-old-jwt-secret-0123456789abcdef0123456789' };
    const NEW = { JWT_SECRET: 'the-new-jwt-secret-0123456789abcdef0123456789', UNSUBSCRIBE_KEY: 'c'.repeat(64) };

    it('unsubscribe_key.js: keeps the old key as legacy; old links pass the check with it and fail without', () => {
        const line = run('unsubscribe_key.js', OLD).stdout;
        expect(line).toMatch(/^UNSUBSCRIBE_KEY_LEGACY=[0-9a-f]{64}\n$/);
        const legacy = line.trim().split('=')[1];
        const sample = run('unsubscribe_key.js', OLD, 'sample').stdout.trim();

        const ok = run('unsubscribe_key.js', { ...NEW, UNSUBSCRIBE_KEY_LEGACY: legacy }, 'check', sample);
        expect([ok.status, ok.stdout]).toEqual([0, 'OK: links emailed before the change can still unsubscribe.\n']);
        const broken = run('unsubscribe_key.js', NEW, 'check', sample);
        expect(broken.status).toBe(1);
        expect(broken.stdout).toMatch(/^NOT ACCEPTED/);
    });

    it('unsubscribe_key.js: once UNSUBSCRIBE_KEY is set there is nothing to keep, and nothing is printed', () => {
        const r = run('unsubscribe_key.js', NEW);
        expect(r.status).toBe(1);
        expect(r.stdout).toBe('');
        expect(r.stderr).toMatch(/already set/);
    });

    it('key_status.js: says what is set and never prints a value', () => {
        const env = { ...NEW, REFRESH_TOKEN_SECRET: 'r'.repeat(64), MONGODB_URI: 'mongodb://db/x', UNSUBSCRIBE_KEY_LEGACY: 'd'.repeat(64) };
        const out = run('key_status.js', env).stdout;
        expect(out).toMatch(/^JWT_SECRET: set, 45 characters, id [0-9a-f]{8}$/m);
        expect(out).toMatch(/^MFA_ENCRYPTION_KEY: NOT SET/m);
        expect(out).toMatch(/^UNSUBSCRIBE_KEY: set, id [0-9a-f]{8}$/m);
        expect(out).toMatch(/^UNSUBSCRIBE_KEY_LEGACY: set, id /m);
        expect(out).not.toMatch(/PROBLEM/);
        for (const v of [env.JWT_SECRET, env.REFRESH_TOKEN_SECRET, env.UNSUBSCRIBE_KEY, env.UNSUBSCRIBE_KEY_LEGACY]) expect(out).not.toContain(v);

        const bad = run('key_status.js', { ...env, MFA_ENCRYPTION_KEY: 'x'.repeat(64), REFRESH_TOKEN_SECRET: env.JWT_SECRET }).stdout;
        expect(bad).toMatch(/^MFA_ENCRYPTION_KEY: NOT USABLE/m);
        expect(bad).toMatch(/^PROBLEM: JWT_SECRET and REFRESH_TOKEN_SECRET must be different$/m);
    });
});
