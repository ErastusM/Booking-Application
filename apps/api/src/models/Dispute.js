const mongoose = require('mongoose');

/**
 * A card dispute (chargeback) or a client's complaint that a paid service was
 * not provided (payment specification, sections 9 and 10). Bookplus records
 * the case, its deadline and evidence, and how it ended:
 *
 *   open      being worked on
 *   won       the card company kept the payment with Bookplus
 *   lost      the money went back to the client's card; Bookplus may recover
 *             the loss (the amount plus the processor's fee) from the business,
 *             with a director's approval: one `chargeback:<dispute id>` ledger
 *             entry, so it can never be taken twice
 *   refunded  a complaint Bookplus upheld: the client was refunded
 *   closed    nothing more to do (for example a complaint not upheld)
 */
const disputeSchema = new mongoose.Schema({
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    kind: { type: String, enum: ['chargeback', 'service_not_provided', 'other'], required: true },
    status: { type: String, enum: ['open', 'won', 'lost', 'refunded', 'closed'], default: 'open' },
    amountCents: { type: Number, required: true, min: 1 }, // what is disputed
    feeCents: { type: Number, default: 0, min: 0 }, // the card processor's chargeback fee
    currency: { type: String, default: 'NAD', uppercase: true },
    caseReference: { type: String, default: '', trim: true, maxlength: 120 }, // the processor's or bank's case number
    deadlineAt: { type: Date, default: null }, // when evidence is due
    summary: { type: String, default: '', trim: true, maxlength: 1000 },
    notes: {
        type: [{
            text: { type: String, required: true, maxlength: 2000 },
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            at: { type: Date, default: Date.now },
        }],
        default: [],
    },
    // Private files (authenticated delivery), opened through short-lived links.
    evidence: {
        type: [{
            name: { type: String, default: '', maxlength: 200 },
            publicId: { type: String, required: true },
            resourceType: { type: String, default: 'image' },
            format: { type: String, default: '' },
            deliveryType: { type: String, default: 'authenticated' },
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            at: { type: Date, default: Date.now },
        }],
        default: [],
    },
    // Recovering a lost chargeback from the business (director-approved).
    recovery: {
        type: new mongoose.Schema({
            request: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceRequest' },
            amountCents: Number,
            status: { type: String, enum: ['pending', 'done', 'rejected', 'failed'], default: 'pending' },
            at: Date,
        }, { _id: false }),
        default: undefined,
    },
    // A refund prepared from this case (a complaint upheld).
    refundRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceRequest', default: null },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedAt: { type: Date, default: null },
    outcomeNote: { type: String, default: '', maxlength: 1000 },
}, { timestamps: true });

disputeSchema.index({ status: 1, deadlineAt: 1 });

module.exports = mongoose.model('Dispute', disputeSchema);
