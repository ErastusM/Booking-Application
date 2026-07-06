const mongoose = require('mongoose');

const blockedTimeSchema = new mongoose.Schema({
    provider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    // null = business-wide block (today's behavior); set = blocks only this staff member.
    teamMember: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TeamMember',
        default: null,
        index: true,
    },
    date: { type: String, required: true },         // 'YYYY-MM-DD'
    startTime: { type: String, required: true },    // 'HH:MM'
    endTime: { type: String, required: true },      // 'HH:MM'
    reason: { type: String, default: '' },
    isRecurring: { type: Boolean, default: false },
    recurrenceType: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', null],
        default: null,
    },
    recurrenceGroupId: { type: String, default: null, index: true },
    recurrenceEndDate: { type: String, default: null }, // 'YYYY-MM-DD'
}, { timestamps: true });

module.exports = mongoose.model('BlockedTime', blockedTimeSchema);
