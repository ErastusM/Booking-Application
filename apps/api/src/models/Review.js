const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
    {
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        service: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Service',
            required: true,
        },
        appointment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Appointment',
            required: true,
            unique: true, // one review per appointment
        },
        // Which professional this review is FOR. Copied from the appointment at
        // creation so per-professional ratings survive later reassignment of the
        // booking. null = the owner's own column (no roster row). Older reviews
        // created before attribution existed stay null until backfilled.
        teamMember: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TeamMember',
            default: null,
            index: true,
        },
        // The business the review belongs to — lets "all reviews for professional
        // X at business Y" and the per-professional aggregate run off one indexed
        // field without joining back through the service.
        provider: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
        },
        comment: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500,
        },
    },
    { timestamps: true }
);

reviewSchema.index({ service: 1, createdAt: -1 });
reviewSchema.index({ customer: 1 });
// Per-professional review list + aggregate ("a pro's reviews, newest first").
reviewSchema.index({ teamMember: 1, createdAt: -1 });
// Per-business aggregate over the owner column and any member.
reviewSchema.index({ provider: 1, teamMember: 1 });

module.exports = mongoose.model('Review', reviewSchema);