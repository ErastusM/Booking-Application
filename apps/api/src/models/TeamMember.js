const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name:     { type: String, required: true, trim: true, maxlength: 80 },
    role:     { type: String, trim: true, default: 'Staff' },
    email:    { type: String, trim: true, lowercase: true, default: '' },
    phone:    { type: String, trim: true, default: '' },
    color:    { type: String, default: '#f03e16' }, // for calendar colour coding
    isActive: { type: Boolean, default: true },
    // Separate from isActive on purpose: a receptionist or a manager is very
    // much on the team but must never be offered as a bookable professional.
    // isActive answers "do they work here", bookable answers "can clients book
    // them". Defaults true so every existing roster keeps its behaviour.
    bookable: { type: Boolean, default: true },

    // ── Personal details (all optional) ──────────────────────────────────
    // `name` stays a single field rather than splitting into first/last: it is
    // referenced by the calendar, appointment records, emails and the e2e
    // suite, and splitting it would be a migration across all of them for a
    // display nicety.
    photoUrl: { type: String, default: '' },
    country:  { type: String, default: '', trim: true, maxlength: 60 },
    address:  { type: String, default: '', trim: true, maxlength: 200 },
    emergencyContact: {
        name:  { type: String, default: '', trim: true, maxlength: 80 },
        phone: { type: String, default: '', trim: true, maxlength: 40 },
    },
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

    // Per-member price/duration for a service they perform. A member inherits the
    // business's Service price/duration unless they override it here — this is
    // what gives each member autonomy over their own pricing (Erastus N$170,
    // John N$200 for the same service) without forking the shared catalogue.
    // A null field means "inherit that value from the Service".
    serviceOverrides: [{
        service:  { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
        price:    { type: Number, default: null, min: 0 }, // null = inherit Service.price
        duration: { type: Number, default: null, min: 1 }, // minutes; null = inherit Service.duration
    }],
}, { timestamps: true });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
