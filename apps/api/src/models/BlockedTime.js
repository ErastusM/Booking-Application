const mongoose = require('mongoose');

const blockedTimeSchema = new mongoose.Schema({
    provider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    // Scope of the block — whose time it closes:
    //   teamMember set   → only that staff member's lane.
    //   teamMember null  → only the OWNER (the "unassigned" lane).
    // The owner's blocked times never apply to team members (the owner's
    // decision): a member is closed only by blocks in their own lane. There is no
    // business-wide block. New owner blocks are always saved ownerOnly:true;
    // older rows saved "business-wide" (ownerOnly false) used to close every
    // member too — they are now read as the owner's own, and
    // scripts/migrate_owner_blocks_owner_only.js marks them ownerOnly:true.
    teamMember: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TeamMember',
        default: null,
        index: true,
    },
    // Only meaningful when teamMember is null: always true for new rows. Every
    // null-scoped block is treated as the owner's own either way.
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
