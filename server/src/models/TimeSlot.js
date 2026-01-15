const mongoose = require('mongoose');

const timeSlotSchema = new mongoose.Schema(
    {
        date: {
            type: Date,
            required: [true, 'Please add a date']
        },
        startTime: {
            type: String,
            required: [true, 'Please add start time']
        },
        endTime: {
            type: String,
            required: [true, 'Please add end time']
        },
        isAvailable: {
            type: Boolean,
            default: true
        },
        appointment: {
            type: mongoose.Schema.ObjectId,
            ref: 'Appointment',
            default: null
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model('TimeSlot', timeSlotSchema);
