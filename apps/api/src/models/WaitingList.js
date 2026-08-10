const mongoose = require('mongoose');

const waitingListSchema = new mongoose.Schema(
    {
        service: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Service',
            required: true,
        },
        provider: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        // Which staff member the customer is waiting on, or null for "anyone".
        // waitingListHelper has always READ `next.teamMember` — to check the freed
        // slot against the right column and to book the promotion onto it — but the
        // field never existed here and join never stored one, so it was permanently
        // undefined. Promotion therefore ran against the OWNER's column: Alice's
        // cancelled slot could be resold while the waiting customer was booked
        // somewhere else, or promotion was skipped as "taken" while Alice was free.
        teamMember: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TeamMember',
            default: null,
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
            // 'promoting' is a transient claim state: an entry is flipped
            // waiting→promoting atomically before booking, so two concurrent
            // cancellations can't promote the same person twice. It settles to
            // 'promoted' on success, or back to 'waiting' if the slot was retaken.
            type: String,
            enum: ['waiting', 'promoting', 'promoted', 'cancelled'],
            default: 'waiting',
        },
        notified: {
            type: Boolean,
            default: false,
        },
        // When the entry was claimed (waiting→promoting). Lets a stale claim from
        // a crashed promotion be reclaimed instead of stranding the customer.
        promotingAt: {
            type: Date,
            default: null,
        },
        // Set true once the customer app has shown the "a slot opened up!"
        // celebratory moment, so it fires exactly once (and across devices).
        celebrated: {
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