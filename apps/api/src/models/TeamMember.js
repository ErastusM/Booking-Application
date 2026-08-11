const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name:     { type: String, required: true, trim: true, maxlength: 80 },
    role:     { type: String, trim: true, default: 'Staff' },
    email:    { type: String, trim: true, lowercase: true, default: '' },
    phone:    { type: String, trim: true, default: '' },
    color:    { type: String, default: '#f03e16' }, // for calendar colour coding
    isActive: { type: Boolean, default: true },
    // When this member left. Set instead of deleting the row: appointments,
    // earnings and reviews all point at this _id, so removing it would strip the
    // staff member's name off every booking they ever did and break per-staff
    // history. Archived members stay resolvable forever; `isActive:false` is what
    // actually stops new bookings reaching them (see utils/staffBooking).
    archivedAt: { type: Date, default: null, index: true },
    // null = roster-only (today's behavior: assignable on the calendar, no login).
    // Set when the owner invites this member to log in (links a User{role:'staff'}).
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // Which services this member performs. Empty = all of the business's services.
    services: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
}, { timestamps: true });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
