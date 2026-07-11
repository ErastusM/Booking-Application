const mongoose = require('mongoose');

// A tiny advisory-lock collection so periodic jobs (reminders, wallet expiry…)
// run on exactly ONE api instance per tick, even when several containers are up
// or overlap during a rolling restart. One document per lock name; acquisition
// is atomic (see utils/lock.js). Not a queue — just "who holds this right now".
const cronLockSchema = new mongoose.Schema(
    {
        _id: { type: String },          // lock name, e.g. 'reminder-tick'
        holder: { type: String },       // random token identifying the current holder
        expiresAt: { type: Date, required: true }, // lease end; a lock is free once past this
    },
    { versionKey: false, timestamps: true }
);

// Reap freed lock docs (expiresAt set to the past on release). Held locks always
// have a future expiresAt so the TTL monitor never touches them; acquire re-creates
// a reaped doc anyway. Keeps the collection from accumulating stale lock names.
cronLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CronLock', cronLockSchema);
