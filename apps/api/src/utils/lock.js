const { randomUUID } = require('crypto');
const CronLock = require('../models/CronLock');
const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

// Best-effort distributed lock backed by Mongo. Lets periodic jobs run on exactly
// ONE api instance per tick even when several containers are up, or two overlap
// during a rolling restart. Acquire is atomic: take the lock only if it's free or
// its lease has expired; a unique _id makes a racing create fail with E11000, so
// exactly one caller wins. Fails CLOSED — if we can't be sure we hold it, we skip
// the job rather than risk a double run.

async function acquireLock(name, ttlMs) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const token = randomUUID();
    try {
        // Take over an existing lock only if its lease has already expired.
        const taken = await CronLock.findOneAndUpdate(
            { _id: name, expiresAt: { $lte: now } },
            { $set: { holder: token, expiresAt } },
            { new: true }
        );
        if (taken && taken.holder === token) return token;

        // No expired lock matched → try to create it fresh. If a live lock already
        // exists (held elsewhere) the unique _id rejects us with E11000.
        await CronLock.create({ _id: name, holder: token, expiresAt });
        return token;
    } catch (err) {
        if (err && err.code === 11000) return null; // someone else holds it — expected
        log.error({ err: err.message, lock: name }, 'lock acquire failed');
        return null; // fail closed
    }
}

async function releaseLock(name, token) {
    if (!token) return;
    try {
        // Only release if we still hold it — never stomp a lease someone else took over.
        await CronLock.updateOne({ _id: name, holder: token }, { $set: { expiresAt: new Date(0) } });
    } catch (err) {
        log.error({ err: err.message, lock: name }, 'lock release failed');
    }
}

// Run `fn` only if we win the lock `name`; otherwise skip silently and return
// false. Always releases (even if `fn` throws) so the next tick can re-acquire.
// `ttlMs` should comfortably exceed the job's runtime but stay under its interval,
// so a crashed holder's lock frees before the next scheduled run.
async function withLock(name, ttlMs, fn) {
    const token = await acquireLock(name, ttlMs);
    if (!token) return false; // another instance is handling this tick
    try {
        await fn();
        return true;
    } finally {
        await releaseLock(name, token);
    }
}

module.exports = { withLock, acquireLock, releaseLock };
