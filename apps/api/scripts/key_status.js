/**
 * What the API sees for its keys, never their values (docs/ROTATING_SECRETS.md).
 * Each key gets a short id (a hash fragment) so you can tell, after a restart,
 * whether it changed. Run in the server container, from /app on the server:
 *   docker compose exec -T server node scripts/key_status.js
 */
require('dotenv').config();
const crypto = require('crypto');
const { envProblems } = require('../src/utils/envCheck');

const env = process.env;
const HEX = /^[0-9a-f]{64}$/i;
const id = (v) => crypto.createHash('sha256').update(`bookplus-key-id:${v}`).digest('hex').slice(0, 8);
const secret = (k) => (env[k] ? `set, ${env[k].length} characters, id ${id(env[k])}` : 'NOT SET');

// The same rules the API applies at start, as in production.
const { fatal, warn } = envProblems({ ...env, NODE_ENV: 'production' });
const mfaWarn = warn.find((w) => w.startsWith('MFA_ENCRYPTION_KEY'));
const mfa = !env.MFA_ENCRYPTION_KEY ? 'NOT SET: a key derived from JWT_SECRET is in use'
    : mfaWarn ? 'NOT USABLE: a key derived from JWT_SECRET is in use'
        : `set, id ${id(env.MFA_ENCRYPTION_KEY)}`;
const hexKey = (k, unset) => (!env[k] ? unset : HEX.test(env[k]) ? `set, id ${id(env[k])}` : 'NOT USABLE (needs 64 hex characters)');

const lines = [
    `JWT_SECRET: ${secret('JWT_SECRET')}`,
    `REFRESH_TOKEN_SECRET: ${secret('REFRESH_TOKEN_SECRET')}`,
    `JWT_EXPIRE: ${env.JWT_EXPIRE || 'not set (15m)'}`,
    `MFA_ENCRYPTION_KEY: ${mfa}`,
    `UNSUBSCRIBE_KEY: ${hexKey('UNSUBSCRIBE_KEY', 'not set: links are signed with a key derived from JWT_SECRET')}`,
    `UNSUBSCRIBE_KEY_LEGACY: ${hexKey('UNSUBSCRIBE_KEY_LEGACY', 'not set')}`,
];
for (const l of lines) console.log(l);
for (const f of fatal) console.log(`PROBLEM: ${f}`);
