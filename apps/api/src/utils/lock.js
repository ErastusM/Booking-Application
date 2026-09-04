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

// Thrown when a booking can't acquire its slot lock in time — the caller turns
// this into a "try again" response rather than risking a double-book.
class BookingBusyError extends Error {
    constructor(message) {
        super(message || 'That time was just taken. Please choose another slot.');
        this.name = 'BookingBusyError';
        this.code = 'BOOKING_BUSY';
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Booking serialization. The cron withLock SKIPS if the lock is held (only one
// instance should run a tick); a booking must instead WAIT its turn, so two
// requests for the same slot run one-after-another and the second sees the
// first and is refused — closing the check-then-insert race that let two
// bookings land on the same person. Acquires with bounded polling; if the slot
// stays locked past `waitMs` it fails CLOSED (throws BookingBusyError) rather
// than proceed unguarded. Returns whatever `fn` returns.
async function withBookingLock(name, fn, { ttlMs = 15000, waitMs = 8000, pollMs = 75 } = {}) {
    let token = await acquireLock(name, ttlMs);
    const deadline = Date.now() + waitMs;
    while (!token && Date.now() < deadline) {
        await sleep(pollMs);
        token = await acquireLock(name, ttlMs);
    }
    if (!token) throw new BookingBusyError();
    try {
        return await fn();
    } finally {
        await releaseLock(name, token);
    }
}

// Acquire SEVERAL booking locks at once (a multi-service ticket touches more than
// one member). Locks are taken in a deterministic sorted order so two concurrent
// multi-member tickets can never deadlock, and released in reverse as the nesting
// unwinds. Runs `fn` holding all of them.
async function withBookingLocks(names, fn, opts) {
    const uniq = [...new Set((names || []).filter(Boolean))].sort();
    if (uniq.length === 0) return fn();
    const run = (i) => (i >= uniq.length ? fn() : withBookingLock(uniq[i], () => run(i + 1), opts));
    return run(0);
}

// The lock name for one provider+member+day. Shared so the booking controller and
// the waiting-list promoter serialize on the SAME key. `teamMember` null (or the
// 'owner' sentinel) is the owner's own column.
const { toDateKey } = require('./blockedTime');
const bookingLockKey = (providerId, teamMember, appointmentDate) =>
    `booking:${providerId}:${(teamMember && teamMember !== 'owner') ? teamMember : 'owner'}:${toDateKey(appointmentDate)}`;

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

module.exports = { withLock, withBookingLock, withBookingLocks, bookingLockKey, acquireLock, releaseLock, BookingBusyError };
