const mongoose = require('mongoose');
const crypto = require('crypto');

// Short, human-quotable booking reference (like "K7P2QF4D"). Uses an unambiguous
// alphabet — no 0/O, 1/I/L, U — so customers can read it over the phone and
// support can look it up without confusion. Generated in write-time hooks (below)
// rather than a schema `default`, because a default is re-applied when Mongoose
// hydrates older docs that lack the field — which would change the reference on
// every read. Hooks run only on write, so a stored reference stays stable.
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const genBookingReference = () => {
    const bytes = crypto.randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i++) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
    return out;
};

const appointmentSchema = new mongoose.Schema(
    {
        // Customer-facing reference for support ("quote your booking ID").
        bookingReference: {
            type: String,
            unique: true,
            sparse: true,
            uppercase: true,
        },
        customer: {
            type: mongoose.Schema.ObjectId,
            ref: 'User',
            required: true
        },
        service: {
            type: mongoose.Schema.ObjectId,
            ref: 'Service',
            required: true
        },
        provider: {
            type: mongoose.Schema.ObjectId,
            ref: 'User',
            default: null
        },
        appointmentDate: {
            type: Date,
            required: [true, 'Please select an appointment date']
        },
        startTime: {
            type: String,
            required: [true, 'Please select a start time']
        },
        endTime: {
            type: String,
            required: [true, 'End time is required']
        },
        status: {
            type: String,
            enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'],
            default: 'pending'
        },
        /* Audit trail of status changes */
        statusHistory: {
            type: [{
                status:    { type: String, required: true },
                changedBy: { type: mongoose.Schema.ObjectId, ref: 'User', default: null },
                changedAt: { type: Date, default: Date.now },
            }],
            default: [],
        },
        notes: {
            type: String,
            default: ''
        },
        totalPrice: {
            type: Number,
            required: true
        },
        cancellationReason: {
            type: String,
            default: null
        },
        paymentStatus: {
            type: String,
            enum: ['unpaid', 'paid', 'refunded'],
            default: 'unpaid',
        },
        paymentIntentId: {
            type: String,
            default: '',
        },
        selectedAddOns: {
            type: [{
                name: { type: String, required: true },
                price: { type: Number, required: true },
                duration: { type: Number, default: 0 },
            }],
            default: [],
        },
        reminderSent24h: { type: Boolean, default: false },
        reminderSent5h:  { type: Boolean, default: false },
        reminderSent1h:  { type: Boolean, default: false },
        walkInName: { type: String, default: null },
        /* How the client pays: from their prepaid wallet, or cash at the appointment */
        paymentMethod: { type: String, enum: ['cash', 'wallet'], default: 'cash' },
        /* Staff member performing the appointment (multi-chair scheduling) */
        teamMember: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamMember', default: null },
        /* Opaque token for no-login "manage my booking" links */
        manageToken: { type: String, default: null, index: true },
        /* Group booking — shared slot for multiple clients */
        groupId:    { type: String, default: null }, // UUID shared by all appointments in the group
        groupSize:  { type: Number, default: 1 },    // max participants in the group
        /* Recurring appointment fields */
        isRecurring:        { type: Boolean, default: false },
        recurrenceType:     { type: String, enum: ['daily', 'weekly', 'monthly', null], default: null },
        recurrenceInterval: { type: Number, default: 1 }, // repeat every N units (custom frequency)
        recurrenceGroupId:  { type: String, default: null },
        recurrenceEndDate:  { type: Date, default: null },
    },
    {
        timestamps: true
    }
);

// Indexes for faster queries
appointmentSchema.index({ customer: 1, appointmentDate: 1 });
appointmentSchema.index({ appointmentDate: 1, status: 1 });
appointmentSchema.index({ provider: 1, appointmentDate: -1 });
appointmentSchema.index({ paymentStatus: 1 });
appointmentSchema.index({ reminderSent24h: 1, appointmentDate: 1, status: 1 });
appointmentSchema.index({ reminderSent5h: 1, appointmentDate: 1, status: 1 });
appointmentSchema.index({ reminderSent1h: 1, appointmentDate: 1, status: 1 });
appointmentSchema.index({ recurrenceGroupId: 1, appointmentDate: 1 });

// Stamp a booking reference on creation. Two hooks cover the two creation paths:
// single create()/save(), and bulk insertMany() (recurring + group bookings),
// which bypasses document middleware. Only new docs get one — existing bookings
// keep showing the stable id-derived fallback the UI uses.
appointmentSchema.pre('save', function (next) {
    if (this.isNew && !this.bookingReference) this.bookingReference = genBookingReference();
    next();
});

// Rescheduling moves the booking to a new instant, so any reminders that already
// fired for the OLD slot must not suppress the reminders for the NEW one. Clear
// the flags whenever an existing booking's date/time actually changes — the cron
// then re-evaluates its windows against the new start and re-sends. Without this,
// a client who reschedules after their 24h/1h reminder went out gets no reminder
// for the new time. New docs already default to false, and the cron marks flags
// via findByIdAndUpdate (which bypasses this hook), so neither is affected.
appointmentSchema.pre('save', function (next) {
    if (!this.isNew && (this.isModified('appointmentDate') || this.isModified('startTime'))) {
        this.reminderSent24h = false;
        this.reminderSent5h = false;
        this.reminderSent1h = false;
    }
    next();
});

appointmentSchema.pre('insertMany', function (next, docs) {
    if (Array.isArray(docs)) {
        for (const doc of docs) {
            if (doc && !doc.bookingReference) doc.bookingReference = genBookingReference();
        }
    }
    next();
});

module.exports = mongoose.model('Appointment', appointmentSchema);
