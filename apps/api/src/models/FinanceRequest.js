const mongoose = require('mongoose');

/**
 * A money action waiting for a second person (payment specification, section
 * 7): finance prepares it, a director who is not the preparer approves or
 * rejects it, and only then does it run. Used for refunds above the approval
 * threshold and for every manual balance adjustment.
 */
const financeRequestSchema = new mongoose.Schema({
    type: { type: String, enum: ['refund', 'adjustment'], required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'executed', 'failed'], default: 'pending' },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    amountCents: { type: Number, required: true }, // refund: > 0; adjustment: signed (+ credits the business)
    currency: { type: String, default: 'NAD', uppercase: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '', maxlength: 1000 },
    // What running it produced (e.g. the refund id), or why it failed.
    result: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

financeRequestSchema.index({ status: 1, createdAt: -1 });
financeRequestSchema.index({ provider: 1, createdAt: -1 });

module.exports = mongoose.model('FinanceRequest', financeRequestSchema);
