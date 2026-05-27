const mongoose = require('mongoose');

const clientPackageSchema = new mongoose.Schema({
    customer:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    package:           { type: mongoose.Schema.Types.ObjectId, ref: 'Package', required: true },
    provider:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sessionsTotal:     { type: Number, required: true },
    sessionsUsed:      { type: Number, default: 0 },
    sessionsRemaining: { type: Number, required: true },
    purchasePrice:     { type: Number, required: true },
    purchasedAt:       { type: Date, default: Date.now },
    expiryDate:        { type: Date, required: true },
    status:            { type: String, enum: ['active', 'expired', 'used'], default: 'active' },
}, { timestamps: true });

clientPackageSchema.index({ customer: 1, status: 1 });
clientPackageSchema.index({ provider: 1 });

module.exports = mongoose.model('ClientPackage', clientPackageSchema);
