const mongoose = require('mongoose');

const timeSlotSchema = new mongoose.Schema({
    start: { type: String, required: true }, // e.g. "09:00"
    end: { type: String, required: true },   // e.g. "17:00"
});

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
}, { timestamps: true });

module.exports = mongoose.model('StaffAvailability', staffAvailabilitySchema);
