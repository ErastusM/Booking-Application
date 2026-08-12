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
 * A team member's working day for ONE specific date.
 *
 * StaffAvailability is the weekly pattern — "Moses works 9–6 on Tuesdays". A
 * Shift is the exception for a single date: he came in late, covered a Sunday,
 * or takes lunch at 13:00 that day. It exists because a business is open while
 * an individual is not, and the pattern alone can't express that.
 *
 * PRECEDENCE, and this is the whole contract:
 *
 *     a Shift for the date  →  the member's weekly pattern  →  business hours
 *
 * A Shift, when present, REPLACES the pattern for that date rather than adding
 * to it. That is what makes "I'm not in on Thursday" expressible: a shift with
 * no slots is a day off, and there is no way to say that by editing a weekly
 * pattern without changing every other Thursday too.
 *
 * Breaks subtract from the shift's own slots. They are stored on the shift
 * rather than as BlockedTime because they belong to the shape of the working
 * day, not to an interruption of it — and because BlockedTime is what time off
 * uses, which is a different thing the owner manages separately.
 */
const shiftSchema = new mongoose.Schema({
    provider:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    teamMember: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamMember', required: true },
    // Stored as a plain YYYY-MM-DD key, not a Date. A shift is a wall-clock
    // fact about a named day; storing it as an instant invites the timezone
    // drift that has already bitten the reminder cron and the cancellation
    // window in this codebase.
    date: { type: String, required: true },
    // Empty slots = rostered off that day. Distinct from having no Shift row at
    // all, which means "fall back to the weekly pattern".
    slots:  { type: [periodSchema], default: [] },
    breaks: { type: [breakSchema],  default: [] },
    note:   { type: String, default: '', trim: true, maxlength: 120 },
}, { timestamps: true });

// One shift per member per day; upserts rely on this.
shiftSchema.index({ teamMember: 1, date: 1 }, { unique: true });
shiftSchema.index({ provider: 1, date: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
