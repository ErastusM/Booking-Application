/**
 * The boot check (server.js → utils/envCheck): what stops the API starting and
 * what it warns about. The warnings name the keys still derived from
 * JWT_SECRET, which must be pinned before JWT_SECRET is rotated.
 */
const { envProblems } = require('../../utils/envCheck');

const HEX = 'a'.repeat(64);
const base = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://db/bookplus',
    JWT_SECRET: 'j'.repeat(64),
    REFRESH_TOKEN_SECRET: 'r'.repeat(64),
    MFA_ENCRYPTION_KEY: HEX,
    UNSUBSCRIBE_KEY: 'b'.repeat(64),
};

describe('envProblems', () => {
    it('a complete production environment starts with nothing to warn about', () => {
        expect(envProblems(base)).toEqual({ fatal: [], warn: [] });
    });

    it('missing keys, equal keys and short keys refuse to start', () => {
        expect(envProblems({ ...base, MONGODB_URI: '' }).fatal).toEqual(['Missing required environment variables: MONGODB_URI']);
        expect(envProblems({ ...base, REFRESH_TOKEN_SECRET: base.JWT_SECRET }).fatal).toEqual(['JWT_SECRET and REFRESH_TOKEN_SECRET must be different']);
        expect(envProblems({ ...base, JWT_SECRET: 'short' }).fatal[0]).toMatch(/too short.*JWT_SECRET/);
        // Short keys are fine outside production (tests, local).
        expect(envProblems({ ...base, NODE_ENV: 'test', JWT_SECRET: 'short' }).fatal).toEqual([]);
    });

    it('an UNSUBSCRIBE_KEY that is set but not 64 hex characters refuses to start', () => {
        expect(envProblems({ ...base, UNSUBSCRIBE_KEY: 'not-hex' }).fatal).toEqual(['UNSUBSCRIBE_KEY must be 32 bytes as hex (64 characters)']);
        expect(envProblems({ ...base, UNSUBSCRIBE_KEY: HEX.slice(1) }).fatal).toHaveLength(1);
        expect(envProblems({ ...base, UNSUBSCRIBE_KEY_LEGACY: 'nope' }).fatal).toEqual(['UNSUBSCRIBE_KEY_LEGACY must be 32 bytes as hex (64 characters)']);
        expect(envProblems({ ...base, UNSUBSCRIBE_KEY_LEGACY: HEX }).fatal).toEqual([]);
    });

    it('warns in production about keys still derived from JWT_SECRET', () => {
        const { fatal, warn } = envProblems({ ...base, MFA_ENCRYPTION_KEY: '', UNSUBSCRIBE_KEY: '' });
        expect(fatal).toEqual([]);
        expect(warn).toEqual([
            expect.stringMatching(/^MFA_ENCRYPTION_KEY is not set/),
            expect.stringMatching(/^UNSUBSCRIBE_KEY is not set/),
        ]);
        expect(envProblems({ ...base, MFA_ENCRYPTION_KEY: 'too-short' }).warn).toEqual([expect.stringMatching(/not 32 bytes/)]);
        // 32 bytes as base64 is accepted, as utils/mfa.js does.
        expect(envProblems({ ...base, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }).warn).toEqual([]);
        expect(envProblems({ ...base, NODE_ENV: 'development', MFA_ENCRYPTION_KEY: '', UNSUBSCRIBE_KEY: '' }).warn).toEqual([]);
    });
});
