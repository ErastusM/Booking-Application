const mongoose = require('mongoose');

/**
 * One customer booking attempt the system REFUSED (outside hours, no staff
 * free, blocked time, slot conflict). The post-mortem case: a misconfigured
 * schedule turned customers away for days and the owner only learned via a
 * client's WhatsApp screenshot — these records power the owner-side signal
 * (bell alert on a burst, Overview card for the ambient count).
 *
 * Deliberately tiny and short-lived: the TTL below expires records after the
 * 7-day window the Overview card reports, so this never becomes an analytics
 * store — it's a smoke detector.
 */
const bookingRejectionSchema = new mongoose.Schema(
    {
        provider: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        // Machine reason code ('outside_hours', 'no_staff_available', 'blocked',
        // 'slot_taken', or a staff-availability reason like 'time_off').
        reason: { type: String, required: true },
        // The slot the customer wanted — 'YYYY-MM-DD' + 'HH:MM', kept so a future
        // view could show WHICH times people are asking for.
        date: { type: String, default: '' },
        startTime: { type: String, default: '' },
    },
    { timestamps: true }
);

bookingRejectionSchema.index({ provider: 1, createdAt: -1 });
// Self-cleaning after the 7-day reporting window.
bookingRejectionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('BookingRejection', bookingRejectionSchema);
