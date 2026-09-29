const mongoose = require('mongoose');

const periodSchema = new mongoose.Schema({
    start: { type: String, required: true },   // "09:00"
    end:   { type: String, required: true },   // "17:00"
}, { _id: false });

const breakSchema = new mongoose.Schema({
    start: { type: String, required: true },
    end:   { type: String, required: true },
    label: { type: String, default: 'Break', trim: true, maxlength: 40 },
}, { _id: false });

/**
 * LEGACY: a team member's working day for ONE specific date, saved by the old
 * "Shifts" screen (removed in #249).
 *
 * These rows NO LONGER affect anything about hours. A member's bookable hours
 * are their weekly Working Hours (StaffAvailability) only, minus their own
 * blocked time and approved time off. Every hours reader (booking validation,
 * slot pickers, search, waiting list, calendar shading, readiness, stats)
 * ignores Shift. The model and routes are kept so old data and clients don't
 * break; nothing is deleted.
 */
const shiftSchema = new mongoose.Schema({
    provider:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    teamMember: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    // Stored as a plain YYYY-MM-DD key, not a Date. A shift is a wall-clock
    // fact about a named day; storing it as an instant invites the timezone
    // drift that has already bitten the reminder cron and the cancellation
    // window in this codebase.
    date: { type: String, required: true },
    slots:  { type: [periodSchema], default: [] },
    breaks: { type: [breakSchema],  default: [] },
    note:   { type: String, default: '', trim: true, maxlength: 120 },
}, { timestamps: true });

// One shift per member per day; upserts rely on this.
shiftSchema.index({ teamMember: 1, date: 1 }, { unique: true });
shiftSchema.index({ provider: 1, date: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
