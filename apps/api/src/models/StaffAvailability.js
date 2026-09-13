const mongoose = require('mongoose');

const timeSlotSchema = new mongoose.Schema({
    start: { type: String, required: true }, // e.g. "09:00"
    end: { type: String, required: true },   // e.g. "17:00"
});

// A single week's pattern, same seven-day shape as `schedule` below. Reused for
// the entries of a rotating (multi-week) cycle. _id:false — a rotation week is
// positional (its index in the cycle is its identity), not an addressable row.
const weekPatternSchema = new mongoose.Schema({
    monday:    { enabled: { type: Boolean, default: false }, slots: [timeSlotSchema] },
    tuesday:   { enabled: { type: Boolean, default: false }, slots: [timeSlotSchema] },
    wednesday: { enabled: { type: Boolean, default: false }, slots: [timeSlotSchema] },
    thursday:  { enabled: { type: Boolean, default: false }, slots: [timeSlotSchema] },
    friday:    { enabled: { type: Boolean, default: false }, slots: [timeSlotSchema] },
    saturday:  { enabled: { type: Boolean, default: false }, slots: [timeSlotSchema] },
    sunday:    { enabled: { type: Boolean, default: false }, slots: [timeSlotSchema] },
}, { _id: false });

/**
 * An OPTIONAL rotating (multi-week) schedule. When `weeks` is non-empty, the
 * booking resolver uses weeks[weekIndex] for a date INSTEAD of the flat
 * `schedule` below, where weekIndex = floor(daysSince(anchor)/7) mod weeks.length.
 *
 * `anchor` is the YYYY-MM-DD date on which weeks[0] begins — the same wall-clock
 * date-string basis the Shift/TimeOff keys use, so the rotation week a date
 * falls in never disagrees with its shift/leave rows at a timezone boundary.
 *
 * Empty `weeks` (the default, and every legacy row) means NO rotation: the flat
 * `schedule` is the member's single repeating week, exactly as before. A
 * per-date Shift still overrides whichever rotation week the date lands on.
 */
const rotationSchema = new mongoose.Schema({
    anchor: { type: String, default: '' },
    weeks: { type: [weekPatternSchema], default: [] },
}, { _id: false });

// Per-staff working hours, mirroring Availability's shape. ABSENCE of a doc
// means the staff member inherits the business hours (Availability) — only
// create one when their schedule differs.
const staffAvailabilitySchema = new mongoose.Schema({
    // Business owner — denormalized for cheap provider-scoped queries.
    provider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    teamMember: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TeamMember',
        required: true,
        unique: true, // one schedule per staff member
    },
    schedule: {
        monday:    { enabled: { type: Boolean, default: true }, slots: [timeSlotSchema] },
        tuesday:   { enabled: { type: Boolean, default: true }, slots: [timeSlotSchema] },
        wednesday: { enabled: { type: Boolean, default: true }, slots: [timeSlotSchema] },
        thursday:  { enabled: { type: Boolean, default: true }, slots: [timeSlotSchema] },
        friday:    { enabled: { type: Boolean, default: true }, slots: [timeSlotSchema] },
        saturday:  { enabled: { type: Boolean, default: false }, slots: [timeSlotSchema] },
        sunday:    { enabled: { type: Boolean, default: false }, slots: [timeSlotSchema] },
    },
    // Optional multi-week rotation. Absent/empty weeks == the flat `schedule`
    // above is the single repeating week (back-compatible with every legacy row).
    rotation: { type: rotationSchema, default: () => ({}) },
}, { timestamps: true });

module.exports = mongoose.model('StaffAvailability', staffAvailabilitySchema);
