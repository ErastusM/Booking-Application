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
        proofUrl: { type: String, default: '' }, // LEGACY public proof link (see `proof`)
        // Private proof of payment (Cloudinary `authenticated` asset). Never a
        // public URL: it is opened through a short-lived signed link minted by
        // GET …/proof for the payer and the business only. proofUrl below is the
        // LEGACY public link, emptied by scripts/migrate_private_proofs.js.
        proof: {
            publicId: { type: String, default: '' },
            resourceType: { type: String, enum: ['image', 'raw', ''], default: '' },
            format: { type: String, default: '' },
            deliveryType: { type: String, default: '' },
        },
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


// The proof itself is never serialized — not its public id, not a legacy public
// URL. Clients learn only whether one exists and fetch a signed link on demand.
providerWalletTransactionSchema.set('toJSON', {
    transform(_doc, ret) {
        ret.hasProof = Boolean((ret.proof && ret.proof.publicId) || ret.proofUrl);
        delete ret.proof;
        delete ret.proofUrl;
        return ret;
    },
});

module.exports = mongoose.model('ProviderWalletTransaction', providerWalletTransactionSchema);
