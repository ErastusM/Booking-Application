/**
 * What the environment gets wrong for a safe start. server.js refuses to start
 * on any `fatal` and logs every `warn`.
 */
const HEX_32 = /^[0-9a-f]{64}$/i;
// The same rule utils/mfa.js applies: 32 bytes as hex, or as base64.
const readableMfaKey = (raw) => HEX_32.test(raw) || Buffer.from(raw, 'base64').length === 32;

const envProblems = (env = process.env) => {
    const fatal = [];
    const warn = [];
    const missing = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'MONGODB_URI'].filter((k) => !env[k]);
    if (missing.length) fatal.push(`Missing required environment variables: ${missing.join(', ')}`);
    // One key for both would let a 30-day refresh token pass as a session token.
    if (env.JWT_SECRET && env.JWT_SECRET === env.REFRESH_TOKEN_SECRET) fatal.push('JWT_SECRET and REFRESH_TOKEN_SECRET must be different');
    const production = env.NODE_ENV === 'production';
    const weak = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET'].filter((k) => env[k] && env[k].length < 32);
    if (weak.length && production) fatal.push(`Token secrets are too short for production (need >= 32 chars): ${weak.join(', ')}`);
    // Set but unreadable would quietly fall back to a key derived from JWT_SECRET,
    // and every unsubscribe link already emailed would stop working.
    for (const k of ['UNSUBSCRIBE_KEY', 'UNSUBSCRIBE_KEY_LEGACY']) {
        if (env[k] && !HEX_32.test(env[k])) fatal.push(`${k} must be 32 bytes as hex (64 characters)`);
    }
    if (production) {
        if (!env.MFA_ENCRYPTION_KEY) warn.push('MFA_ENCRYPTION_KEY is not set: admins\' two-step secrets use a key derived from JWT_SECRET (docs/ROTATING_SECRETS.md)');
        else if (!readableMfaKey(env.MFA_ENCRYPTION_KEY)) warn.push('MFA_ENCRYPTION_KEY is not 32 bytes (hex or base64), so a key derived from JWT_SECRET is used instead');
        if (!env.UNSUBSCRIBE_KEY) warn.push('UNSUBSCRIBE_KEY is not set: unsubscribe links are signed with a key derived from JWT_SECRET (docs/ROTATING_SECRETS.md)');
    }
    return { fatal, warn };
};

module.exports = { envProblems };
