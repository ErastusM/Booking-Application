const mongoose = require('mongoose');

/**
 * A payout Bookplus makes to a business. Each one writes a negative
 * LedgerEntry when it is created, so it reduces the balance owed at once.
 *
 *   pending  prepared in a payout run; the bank transfer is being made
 *   paid     the transfer went through (`reference` = the bank's reference)
 *   failed   the bank returned it; a `payout_reversal` ledger entry puts the
 *            money back on the business's balance
 *
 * A payout recorded by hand after the transfer is `paid` straight away. The
 * bank details are a snapshot of where it was sent: masked number only; the
 * full number stays on the business's account.
 */
const payoutSchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amountCents: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'paid' },
    reference: { type: String, default: '', trim: true, maxlength: 120 }, // e.g. the bank transfer reference
    // What Bookplus puts on the transfer, so the business can match it (BPP-…).
    ourReference: { type: String, default: null },
    accountHolder: { type: String, default: null },
    failureReason: { type: String, default: null, maxlength: 500 },
    failedAt: { type: Date, default: null },
    note: { type: String, default: '', maxlength: 500 },
    bankName: { type: String, default: null },
    accountNumberMasked: { type: String, default: null },
    // Which safety checks an admin explicitly overrode: 'balance', 'payout_account'.
    overrides: { type: [String], default: [] },
    paidAt: { type: Date, default: Date.now }, // pending: when it was prepared
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

payoutSchema.index({ provider: 1, paidAt: -1 });
payoutSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Payout', payoutSchema);
