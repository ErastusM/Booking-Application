const mongoose = require('mongoose');

/**
 * One row per wallet event. Doubles as the transaction history shown to clients
 * and providers AND the immutable audit trail: every balance change records the
 * before/after balances, who initiated it and who resolved it.
 *
 * Pending requests (top-ups, manual adjustments) are stored here with
 * status 'pending' and move balances only once approved — so a row can exist
 * without having changed any balance yet.
 *
 * type      — the kind of event
 * status    — where it is in its lifecycle
 * direction — how it moves money: credit/debit total, or reserve/release
 */
const walletTransactionSchema = new mongoose.Schema(
    {
        wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
        customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

        type: {
            type: String,
            enum: ['topup', 'reservation', 'deduction', 'adjustment', 'refund'],
            required: true,
        },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'reserved', 'released', 'completed', 'cancelled'],
            required: true,
        },
        direction: {
            type: String,
            enum: ['credit', 'debit', 'reserve', 'release'],
        },

        amount: { type: Number, required: true, min: 0 },

        reference: { type: String, default: '' }, // client payment ref, e.g. BP-12345
        proofUrl: { type: String, default: '' },   // uploaded proof of payment (image or PDF)
        method: { type: String, enum: ['manual', 'cash', 'online'], default: 'manual' }, // how the client funded the top-up
        reason: { type: String, default: '' },      // adjustment / refund / note

        appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },

        // Audit snapshot — balances immediately before and after this event applied.
        balanceBefore: {
            total: { type: Number, default: null },
            reserved: { type: Number, default: null },
        },
        balanceAfter: {
            total: { type: Number, default: null },
            reserved: { type: Number, default: null },
        },

        initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        resolvedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

walletTransactionSchema.index({ wallet: 1, createdAt: -1 });
walletTransactionSchema.index({ provider: 1, status: 1 });
walletTransactionSchema.index({ customer: 1, createdAt: -1 });
// Used to find the live reservation for an appointment (release / deduction).
walletTransactionSchema.index({ appointment: 1, type: 1, status: 1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
