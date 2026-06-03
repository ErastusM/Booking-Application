const mongoose = require('mongoose');

const waitingListSchema = new mongoose.Schema(
    {
        service: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Service',
            required: true,
        },
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        appointmentDate: {
            type: Date,
            required: true,
        },
        startTime: {
            type: String,
            required: true,
        },
        endTime: {
            type: String,
            required: true,
        },
        position: {
            type: Number,
            required: true,
        },
        status: {
            type: String,
            enum: ['waiting', 'promoted', 'cancelled'],
            default: 'waiting',
        },
        notified: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

// Composite index for the slot lookup used on every join/promote/position shift
waitingListSchema.index({ service: 1, appointmentDate: 1, startTime: 1, status: 1 });
waitingListSchema.index({ customer: 1, status: 1 });

module.exports = mongoose.model('WaitingList', waitingListSchema);