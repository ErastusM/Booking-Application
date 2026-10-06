const mongoose = require('mongoose');

/**
 * One online card payment attempt for a booking, through PayGate PayHost.
 *
 * A booking can have several attempts (a declined card, then a retry); at most
 * one of them ends `paid`. Money is integer cents in `currency` (NAD), never a
 * float. No card data ever reaches Bookplus (hosted page) — the stored gateway
 * fields are PayGate's own identifiers and result codes only.
 *
 * Status:
 *   initiated          session requested / client sent to PayGate
 *   pending            PayGate received it and is still processing (status 5)
 *   paid               PayGate approved it and our Query confirmed amount,
 *                      currency and reference
 *   failed             declined / voided / gateway error
 *   cancelled          the client (or PayGate) cancelled, or a newer attempt
 *                      replaced this one
 *   expired            the booking's payment hold ran out first
 *   refund_pending     a refund was requested and has not gone through yet
 *                      (see refunds[].gatewayStatus / error) — retryable
 *   partially_refunded / refunded
 */
const STATUSES = ['initiated', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'refund_pending', 'partially_refunded', 'refunded'];
// Statuses in which money was taken (some of it may since have been refunded).
const SETTLED = ['paid', 'refund_pending', 'partially_refunded', 'refunded'];
// Statuses PayGate may still move (we have not seen a final answer yet).
const OPEN = ['initiated', 'pending'];

const refundSchema = new mongoose.Schema({
    amountCents: { type: Number, required: true },
    reason: { type: String, default: '', maxlength: 500 },
    // business_cancelled | client_cancelled | booking_released | manual
    trigger: { type: String, default: 'manual' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, default: Date.now },
    // requested → done | failed (a failed refund stays reserved and can be retried)
    gatewayStatus: { type: String, enum: ['requested', 'done', 'failed'], default: 'requested' },
    gatewayTransactionId: { type: String, default: null },
    resultCode: { type: String, default: null },
    error: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
});

const paymentSchema = new mongoose.Schema({
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, index: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    guestEmail: { type: String, default: null, lowercase: true, trim: true },
    guestName: { type: String, default: null, trim: true },
    kind: { type: String, enum: ['deposit', 'full'], required: true },
    amountCents: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true },
    // Our MerchantOrderId — random and unguessable; it is also the public handle
    // for the result page, so it must never be derivable from anything else.
    reference: { type: String, required: true, unique: true },
    payRequestId: { type: String, default: undefined },
    gateway: { type: String, default: 'paygate' },
    status: { type: String, enum: STATUSES, default: 'initiated' },
    transactionId: { type: String, default: null },
    transactionStatusCode: { type: Number, default: null },
    resultCode: { type: String, default: null },
    resultDesc: { type: String, default: null },
    authCode: { type: String, default: null },
    payMethod: { type: String, default: null },
    // Platform commission on this payment (basis points, snapshot at payment time).
    commissionBps: { type: Number, default: 0 },
    refundedCents: { type: Number, default: 0 },
    // Refunds requested but not yet confirmed by PayGate — reserved so two
    // refunds can never together exceed what was paid.
    refundingCents: { type: Number, default: 0 },
    refunds: { type: [refundSchema], default: [] },
    // Approved by PayGate but amount/currency/reference did not match what we
    // asked for — never confirmed automatically; needs a human.
    flagged: { type: Boolean, default: false },
    flagReason: { type: String, default: null },
    statusHistory: {
        type: [{
            _id: false,
            status: String,
            at: { type: Date, default: Date.now },
            source: String, // initiate | return | notify | query | sweep | refund | cancel | retry
            note: String,
        }],
        default: [],
    },
    // The last notify post, with anything card-like removed (paymentService.sanitizeNotify).
    lastNotify: { type: mongoose.Schema.Types.Mixed, default: null },
    lastQueriedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
}, { timestamps: true });

paymentSchema.index({ payRequestId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ provider: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ customer: 1, createdAt: -1 });

const Payment = mongoose.model('Payment', paymentSchema);
Payment.STATUSES = STATUSES;
Payment.SETTLED = SETTLED;
Payment.OPEN = OPEN;

module.exports = Payment;
