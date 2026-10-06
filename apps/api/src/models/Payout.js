const mongoose = require('mongoose');

/**
 * A payout Bookplus made to a business (recorded by an admin after making the
 * bank transfer). Each one also writes a negative LedgerEntry, so it reduces
 * the balance owed. The bank details are a snapshot of where it was sent —
 * masked number only; the full number stays on the business's account.
 */
const payoutSchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amountCents: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true },
    status: { type: String, enum: ['paid'], default: 'paid' },
    reference: { type: String, default: '', trim: true, maxlength: 120 }, // e.g. the bank transfer reference
    note: { type: String, default: '', maxlength: 500 },
    bankName: { type: String, default: null },
    accountNumberMasked: { type: String, default: null },
    // Which safety checks an admin explicitly overrode: 'balance', 'payout_account'.
    overrides: { type: [String], default: [] },
    paidAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

payoutSchema.index({ provider: 1, paidAt: -1 });

module.exports = mongoose.model('Payout', payoutSchema);
