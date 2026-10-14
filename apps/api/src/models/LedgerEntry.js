const mongoose = require('mongoose');

/**
 * What Bookplus owes each business. Online payments settle into Bookplus's own
 * PayGate account, so every movement of a business's money is an entry here:
 *
 *   payment     +  a client paid online for one of the business's bookings
 *   commission  −  Bookplus's percentage commission on that payment; a refund
 *                  hands the commission on the refunded part back (+)
 *   fixed_fee   −  the plan's fixed fee per online booking (Standard: N$1.50);
 *                  handed back (+) only when the payment is refunded in full
 *   processing_fee − the card processing fee, when the business bears it; the
 *                  card company keeps it, so a refund never returns it
 *   refund      −  money given back to the client
 *   payout      −  Bookplus paid the business (bank transfer)
 *   payout_reversal + the bank returned a payout, so the money is owed again
 *   chargeback  −  a card chargeback Bookplus lost, recovered from the business
 *                  (director-approved; keyed chargeback:<dispute id>, so once)
 *   adjustment  ±  a correction recorded by an admin
 *
 * The balance owed is the plain sum of amountCents (signed, integer cents).
 * `key` makes every automatic entry idempotent: a duplicate notify, a retried
 * job or a race can never write the same credit or debit twice.
 */
const ledgerEntrySchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['payment', 'refund', 'commission', 'fixed_fee', 'processing_fee', 'payout', 'payout_reversal', 'chargeback', 'adjustment'], required: true },
    amountCents: { type: Number, required: true },
    currency: { type: String, required: true, uppercase: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    payout: { type: mongoose.Schema.Types.ObjectId, ref: 'Payout', default: null },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    commissionBps: { type: Number, default: null },
    note: { type: String, default: '', maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    key: { type: String, required: true, unique: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

ledgerEntrySchema.index({ provider: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
