const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    provider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    order: {
        type: Number,
        default: 0,
    },
}, { timestamps: true });

// The public provider profile (the booking entry page) lists a provider's
// categories on every load — index the lookup so it isn't a collection scan.
categorySchema.index({ provider: 1 });

module.exports = mongoose.model('Category', categorySchema);