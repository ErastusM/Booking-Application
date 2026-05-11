const mongoose = require('mongoose');

const timeSlotSchema = new mongoose.Schema({
    start: { type: String, required: true }, // e.g. "09:00"
    end: { type: String, required: true },   // e.g. "17:00"
});

const availabilitySchema = new mongoose.Schema({
    provider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
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

module.exports = mongoose.model('Availability', availabilitySchema);