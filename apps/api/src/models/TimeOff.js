const mongoose = require('mongoose');

/**
 * A team member's leave — a CONTINUOUS RANGE of dates they are away, as one
 * object, not a row per day.
 *
 * This is deliberately distinct from the two single-date mechanisms it sits
 * beside:
 *   - a Shift with empty slots is a rostered day off for ONE date (roster
 *     shape), and
 *   - a BlockedTime is a one-date timed block (lunch, a meeting).
 * Neither can say "Moses is on leave the 10th to the 20th" without repeating
 * itself eleven times, which is the gap this fills.
 *
 * Dates are plain 'YYYY-MM-DD' wall-clock keys, never Date instants — the same
 * reason Shift uses strings: leave is a fact about named days, and storing it
 * as an instant invites the timezone drift that has bitten this codebase before.
 * The range is INCLUSIVE of both endpoints.
 *
 * Only APPROVED leave affects bookings. A pending request (self-service) is
 * visible to the owner but does not yet close the member's calendar; a declined
 * one never does.
 */
const timeOffSchema = new mongoose.Schema({
    provider:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    teamMember: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamMember', required: true, index: true },
    // Inclusive 'YYYY-MM-DD' range. endDate >= startDate is enforced in the controller.
    startDate:  { type: String, required: true },
    endDate:    { type: String, required: true },
    // All-day leave closes every day in the range. A windowed leave (allDay:false)
    // closes only startTime–endTime on each day — a recurring afternoon clinic, say.
    allDay:     { type: Boolean, default: true },
    startTime:  { type: String, default: null }, // 'HH:MM', only when !allDay
    endTime:    { type: String, default: null },
    type:       { type: String, enum: ['vacation', 'sick', 'unpaid', 'training', 'other'], default: 'vacation' },
    note:       { type: String, default: '', trim: true, maxlength: 200 },
    // approved leave closes the calendar; pending awaits the owner; declined never applies.
    status:     { type: String, enum: ['pending', 'approved', 'declined'], default: 'approved', index: true },
    // Who raised it: the owner (auto-approved) or the staff member (a request).
    requestedBy:{ type: String, enum: ['owner', 'staff'], default: 'owner' },
    // The owner who approved/declined a request, and when.
    decidedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt:  { type: Date, default: null },
}, { timestamps: true });

// Availability lookups are always "this member, overlapping this date", so index
// the member + range start; the endDate is filtered in memory-cheap fashion.
timeOffSchema.index({ teamMember: 1, status: 1, startDate: 1 });
timeOffSchema.index({ provider: 1, status: 1 });

module.exports = mongoose.model('TimeOff', timeOffSchema);
