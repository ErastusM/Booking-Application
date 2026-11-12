const mongoose = require('mongoose');

/**
 * One card payment for a business's Bookplus plan (models/Subscription.js).
 *
 * kind:
 *   first    the owner adds a card on PayGate's hosted page (terminal
 *            "tokenize", 3D Secure), pays the first month, and PayGate saves
 *            the card
 *   card     the same, with a plan already started: a new card, which pays the
 *            next month (replacing a card, or paying an overdue month)
 *   renewal  the monthly payment from the saved card (terminal "recurring",
 *            nobody present), for the month starting at periodStart
 *
 * status: initiated → pending → paid | failed | cancelled | expired
 * The outcome is only ever decided from a server-side Query to PayGate, never
 * from a callback on its own (services/subscriptionBilling.js).
 */
const OPEN = ['initiated', 'pending'];

const historySchema = new mongoose.Schema({
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    source: { type: String, default: '' }, // initiate | return | notify | query
    note: { type: String, default: '' },
}, { _id: false });

const subscriptionPaymentSchema = new mongoose.Schema({
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', required: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['first', 'card', 'renewal'], default: 'first' },
    terminal: { type: String, enum: ['tokenize', 'recurring'], default: 'tokenize' },
    // The month paid for starts here, and the plan was paid to prevPaidThrough
    // when the payment started (applying it requires that still to be true).
    periodStart: { type: Date, default: null },
    prevPaidThrough: { type: Date, default: null },
    attempt: { type: Number, default: 1 },
    amountCents: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'NAD' },
    reference: { type: String, required: true, unique: true },
    payRequestId: { type: String, default: null },
    status: { type: String, enum: [...OPEN, 'paid', 'failed', 'cancelled', 'expired'], default: 'initiated' },
    transactionId: { type: String, default: null },
    transactionStatusCode: { type: Number, default: null },
    resultCode: { type: String, default: null },
    resultDesc: { type: String, default: null },
    payMethod: { type: String, default: null },
    // Approved by PayGate but something did not add up (amount, reference, no
    // card saved): not applied, or applied and flagged for Bookplus to look at.
    flagged: { type: Boolean, default: false },
    flagReason: { type: String, default: null },
    // The owner ticked "I agree" to these Business Terms before paying.
    termsVersion: { type: String, default: null },
    termsAcceptedAt: { type: Date, default: null },
    termsAcceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidAt: { type: Date, default: null },
    appliedAt: { type: Date, default: null },
    lastQueriedAt: { type: Date, default: null },
    lastNotify: { type: Object, default: null },
    statusHistory: { type: [historySchema], default: [] },
}, { timestamps: true });

subscriptionPaymentSchema.index({ payRequestId: 1 }, { unique: true, partialFilterExpression: { payRequestId: { $type: 'string' } } });
subscriptionPaymentSchema.index({ provider: 1, createdAt: -1 });
subscriptionPaymentSchema.index({ subscription: 1, status: 1 });

subscriptionPaymentSchema.statics.OPEN = OPEN;

module.exports = mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);
