const mongoose = require('mongoose');

// Lightweight product-analytics event — the funnel pipe, NOT a revenue metric
// (money data lives on Appointment/Wallet behind /analytics). We record page
// views, provider views, booking start/confirm, onboarding steps… so we can see
// view→book conversion and where people drop off. Raw rows auto-expire via a TTL
// index to keep the collection bounded; roll up to summaries before they age out
// if long-range history is ever needed.
const eventSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, maxlength: 60 },
        app: { type: String, enum: ['customer', 'business'], default: 'customer' },
        sessionId: { type: String, maxlength: 100 }, // anonymous client session, for funnel stitching
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        path: { type: String, maxlength: 200 },
        props: { type: mongoose.Schema.Types.Mixed }, // small bag of event-specific fields
        ua: { type: String, maxlength: 300 },
        clientTs: { type: Number }, // client-reported ms; server createdAt is authoritative
    },
    { timestamps: true }
);

eventSchema.index({ name: 1, createdAt: -1 });
eventSchema.index({ sessionId: 1, createdAt: 1 });
// Auto-expire raw events after 180 days so the collection can't grow unbounded.
eventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model('Event', eventSchema);
