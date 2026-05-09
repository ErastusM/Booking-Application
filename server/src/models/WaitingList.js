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

module.exports = mongoose.model('WaitingList', waitingListSchema);