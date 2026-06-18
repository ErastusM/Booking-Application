const mongoose = require('mongoose');

/**
 * History + audit row for the provider↔platform wallet. A top-up sits 'pending'
 * (proof attached) until an admin approves it; admin credits/debits apply
 * immediately. Every balance change records before/after and who resolved it.
 */
const providerWalletTransactionSchema = new mongoose.Schema(
    {
        provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        type: { type: String, enum: ['topup', 'credit', 'debit'], required: true },
        status: { type: String, enum: ['pending', 'approved', 'rejected'], required: true },
        amount: { type: Number, required: true, min: 0 },

        method: { type: String, enum: ['manual', 'cash'], default: 'manual' },
        proofUrl: { type: String, default: '' },
        proofType: { type: String, enum: ['image', 'pdf', ''], default: '' },
        reference: { type: String, default: '' },
        reason: { type: String, default: '' },

        balanceBefore: { type: Number, default: null },
        balanceAfter: { type: Number, default: null },

        initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        resolvedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

providerWalletTransactionSchema.index({ provider: 1, createdAt: -1 });
providerWalletTransactionSchema.index({ status: 1, type: 1 });

module.exports = mongoose.model('ProviderWalletTransaction', providerWalletTransactionSchema);
