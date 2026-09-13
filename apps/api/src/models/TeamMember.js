const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name:     { type: String, required: true, trim: true, maxlength: 80 },
    role:     { type: String, trim: true, default: 'Staff', maxlength: 60 },
    email:    { type: String, trim: true, lowercase: true, default: '', maxlength: 120 },
    phone:    { type: String, trim: true, default: '', maxlength: 40 },
    color:    { type: String, default: '#f03e16' }, // for calendar colour coding
    isActive: { type: Boolean, default: true },
    // Separate from isActive on purpose: a receptionist or a manager is very
    // much on the team but must never be offered as a bookable professional.
    // isActive answers "do they work here", bookable answers "can clients book
    // them". Defaults true so every existing roster keeps its behaviour.
    bookable: { type: Boolean, default: true },
    // The "face" of the business — shown first in the roster everywhere (the
    // customer profile, the booking picker, the Team page). At most one member
    // per provider is primary; setting one clears the others.
    isPrimary: { type: Boolean, default: false },

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

    // ── Profile depth ────────────────────────────────────────────────────
    // PUBLIC (shown to customers on the professional's profile / booking picker):
    // a short bio, pronouns, and spoken languages. Exposed only through the
    // allow-list select in providerController.getProviderStaff — adding a field
    // here does NOT leak it; it must be named there to reach customers.
    bio:       { type: String, default: '', trim: true, maxlength: 600 },
    pronouns:  { type: String, default: '', trim: true, maxlength: 40 },
    languages: [{ type: String, trim: true, maxlength: 40 }],

    // OWNER-ONLY (HR metadata — never serialised to customers; only getMyTeam,
    // which returns full docs to the owner, and the owner-gated update path read
    // these). `employment.type` is free-form on purpose — this is a general
    // platform and businesses classify staff differently ("Employed",
    // "Self-employed", "Contractor", "Freelance", …), so no enum.
    employment: {
        type:      { type: String, default: '', trim: true, maxlength: 40 },
        startDate: { type: Date, default: null },
        endDate:   { type: Date, default: null },
    },
    // Private notes the owner keeps about a member. Owner-only — must never appear
    // in any customer-facing payload.
    notes:     { type: String, default: '', trim: true, maxlength: 2000 },
    // When this member left. Set instead of deleting the row: appointments,
    // earnings and reviews all point at this _id, so removing it would strip the
    // staff member's name off every booking they ever did and break per-staff
    // history. Archived members stay resolvable forever; `isActive:false` is what
    // actually stops new bookings reaching them (see utils/staffBooking).
    archivedAt: { type: Date, default: null, index: true },
    // null = roster-only (today's behavior: assignable on the calendar, no login).
    // Set when the owner invites this member to log in (links a User{role:'staff'}).
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // Which services this member performs.
    //
    // This is a general booking platform — a business's roster can mix trades
    // (someone who cuts hair, someone who washes cars, someone who does neither
    // and only runs the desk). So a member's services are their own, and empty
    // does NOT mean "does everything". `offersAllServices` is the explicit switch:
    //   true  → performs every service the business offers
    //   false → performs ONLY the services listed below (empty = none yet)
    //   unset → legacy rows created before this field: empty services = all,
    //           otherwise only the listed ones (preserves prior behaviour).
    // New members are created with offersAllServices:true so the simple
    // single-trade case (everyone does the same work) still works out of the box,
    // while a diverse team can switch a member off and pick their own services.
    offersAllServices: { type: Boolean },
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

// Every roster/slot query filters { provider, isActive } — including the public
// booked-slots endpoint on the booking hot path. Without this it was a collection
// scan whose cost grew with total staff rows platform-wide.
teamMemberSchema.index({ provider: 1, isActive: 1 });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
