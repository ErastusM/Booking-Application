const mongoose = require('mongoose');

/**
 * A team member's worked-time entry — one clock-in→clock-out span.
 *
 * This is the "were they actually here" record, deliberately distinct from the
 * three schedule mechanisms it sits beside (StaffAvailability = the intended
 * weekly pattern, Shift = a rostered day, TimeOff = leave): those say when
 * someone is MEANT to work, a TimeClock entry says when they ACTUALLY did.
 * Timesheets sum these.
 *
 * clockOut null = still on the clock (an open entry). At most ONE open entry per
 * member is enforced in the controller — you can't clock in twice without
 * clocking out. Stored as real Date instants (not wall-clock strings like Shift/
 * TimeOff): a punch is a moment in time, and durations are instant-arithmetic.
 */
const timeClockSchema = new mongoose.Schema({
    provider:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    teamMember: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamMember', required: true, index: true },
    clockIn:    { type: Date, required: true },
    clockOut:   { type: Date, default: null }, // null = still clocked in
    note:       { type: String, default: '', trim: true, maxlength: 200 },
}, { timestamps: true });

// Timesheet reads are always "this member, most recent first / within a range".
timeClockSchema.index({ teamMember: 1, clockIn: -1 });
timeClockSchema.index({ provider: 1, clockIn: -1 });

module.exports = mongoose.model('TimeClock', timeClockSchema);
