const mongoose = require('mongoose');

/**
 * Bookplus's own running costs for one month, entered by hand by a director
 * (payment specification, section 15: hosting, maintenance, marketing and the
 * like). The finance dashboard sets them against what online payments earned,
 * to show break-even progress. Amounts in NAD cents.
 */
const CATEGORIES = ['hosting', 'maintenance', 'marketing', 'staff', 'other'];

const operatingCostSchema = new mongoose.Schema({
    month: { type: String, required: true, unique: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // YYYY-MM
    items: {
        type: [{
            _id: false,
            category: { type: String, enum: CATEGORIES, required: true },
            label: { type: String, default: '', trim: true, maxlength: 80 },
            amountCents: { type: Number, required: true, min: 0 },
        }],
        default: [],
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

operatingCostSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model('OperatingCost', operatingCostSchema);
