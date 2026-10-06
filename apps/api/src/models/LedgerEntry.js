const mongoose = require('mongoose');

/**
 * What Bookplus owes each business. Online payments settle into Bookplus's own
 * PayGate account, so every movement of a business's money is an entry here:
 *
 *   payment     +  a client paid online for one of the business's bookings
 *   commission  −  the platform's commission on that payment (0 by default);
 *                  a refund hands the commission on the refunded part back (+)
 *   refund      −  money given back to the client
 *   payout      −  Bookplus paid the business (bank transfer)
 *   adjustment  ±  a correction recorded by an admin
 *
 * The balance owed is the plain sum of amountCents (signed, integer cents).
 * `key` makes every automatic entry idempotent: a duplicate notify, a retried
 * job or a race can never write the same credit or debit twice.
 */
const ledgerEntrySchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['payment', 'refund', 'commission', 'payout', 'adjustment'], required: true },
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
