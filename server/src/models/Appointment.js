const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema(
    {
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

module.exports = mongoose.model('Appointment', appointmentSchema);
