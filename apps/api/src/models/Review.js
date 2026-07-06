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

module.exports = mongoose.model('Review', reviewSchema);