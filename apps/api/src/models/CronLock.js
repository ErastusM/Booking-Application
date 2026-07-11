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

module.exports = mongoose.model('CronLock', cronLockSchema);
