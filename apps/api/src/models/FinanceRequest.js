const mongoose = require('mongoose');

/**
 * A money action waiting for a second person (payment specification, section
 * 7): finance prepares it, a director who is not the preparer approves or
 * rejects it, and only then does it run. Used for refunds above the approval
 * threshold, for every manual balance adjustment, and for recovering a lost
 * chargeback from the business.
 */
const financeRequestSchema = new mongoose.Schema({
    type: { type: String, enum: ['refund', 'adjustment', 'recovery'], required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'executed', 'failed'], default: 'pending' },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    dispute: { type: mongoose.Schema.Types.ObjectId, ref: 'Dispute', default: null },
    amountCents: { type: Number, required: true }, // refund, recovery: > 0; adjustment: signed (+ credits the business)
    currency: { type: String, default: 'NAD', uppercase: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // A business asked for it (a refund bigger than its balance or the approval
    // limit): preparedBy is the owner, and they hear back when it is decided.
    requestedByBusiness: { type: Boolean, default: false },
    // What the business could refund on its own when it asked (its balance less
    // refunds on their way and its other waiting requests); over it, Bookplus
    // pays the difference until the business earns it back.
    balanceAtRequestCents: { type: Number, default: null },
    overBalance: { type: Boolean, default: false },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '', maxlength: 1000 },
    // What running it produced (e.g. the refund id), or why it failed.
    result: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

financeRequestSchema.index({ status: 1, createdAt: -1 });
financeRequestSchema.index({ provider: 1, createdAt: -1 });
financeRequestSchema.index({ payment: 1, status: 1 });

module.exports = mongoose.model('FinanceRequest', financeRequestSchema);
