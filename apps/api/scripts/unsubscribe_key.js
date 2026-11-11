/**
 * Unsubscribe links when JWT_SECRET is rotated (docs/ROTATING_SECRETS.md).
 * Links never expire. Until UNSUBSCRIBE_KEY is set they are signed with a key
 * derived from JWT_SECRET; that key moves to UNSUBSCRIBE_KEY_LEGACY, where links
 * already emailed can still unsubscribe (never resubscribe), and new links are
 * signed with a fresh UNSUBSCRIBE_KEY.
 *
 *   node scripts/unsubscribe_key.js              UNSUBSCRIBE_KEY_LEGACY=<hex>, the derived key in use now
 *   node scripts/unsubscribe_key.js sample       a test link token (rotation-check@example.com)
 *   node scripts/unsubscribe_key.js check <t>    can that link still unsubscribe? (exit 1 if not)
 *
 * In Docker, from /app on the server (the key goes into the file, never on screen):
 *   docker compose exec -T server node scripts/unsubscribe_key.js >> .env.production
 */
require('dotenv').config();
const { derivedKey, makeUnsubscribeToken, readUnsubscribeToken } = require('../src/utils/marketing');

const HEX = /^[0-9a-f]{64}$/i;
const SAMPLE = 'rotation-check@example.com';
const [mode, token] = process.argv.slice(2);

if (!mode) {
    // With UNSUBSCRIBE_KEY set, links do not depend on JWT_SECRET: nothing to keep.
    if (HEX.test(process.env.UNSUBSCRIBE_KEY || '')) {
        console.error('UNSUBSCRIBE_KEY is already set: unsubscribe links do not depend on JWT_SECRET. Nothing to do.');
        process.exit(1);
    }
    process.stdout.write(`UNSUBSCRIBE_KEY_LEGACY=${derivedKey().toString('hex')}\n`);
} else if (mode === 'sample') {
    process.stdout.write(`${makeUnsubscribeToken({ email: SAMPLE })}\n`);
} else if (mode === 'check') {
    const t = String(token || '').trim();
    const ok = readUnsubscribeToken(t, { optOut: true })?.email === SAMPLE;
    console.log(ok ? 'OK: links emailed before the change can still unsubscribe.' : 'NOT ACCEPTED: links already emailed could not unsubscribe.');
    process.exit(ok ? 0 : 1);
} else {
    console.error('Usage: node scripts/unsubscribe_key.js [sample | check <token>]');
    process.exit(1);
}
