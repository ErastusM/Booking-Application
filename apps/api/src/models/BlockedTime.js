const mongoose = require('mongoose');

const blockedTimeSchema = new mongoose.Schema({
    provider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    // Scope of the block:
    //   teamMember set              → blocks only that staff member's lane.
    //   teamMember null, ownerOnly  → blocks only the OWNER (the "unassigned" lane).
    //   teamMember null, !ownerOnly → business-wide: blocks everyone.
    // `teamMember: null` alone used to mean "business-wide", which conflated the
    // owner's personal blocks with everyone's — so an owner blocking their own
    // lunch closed the whole team. ownerOnly separates the two.
    teamMember: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TeamMember',
        default: null,
        index: true,
    },
    // Only meaningful when teamMember is null. true = the owner's own time only.
    ownerOnly: { type: Boolean, default: false },
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

// The slot feed and every booking create fetch a provider's blocks for ONE date;
// a provider-only index still scanned all of their block rows. Scope by date too.
blockedTimeSchema.index({ provider: 1, date: 1 });

module.exports = mongoose.model('BlockedTime', blockedTimeSchema);
