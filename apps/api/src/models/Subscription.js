const mongoose = require('mongoose');

/**
 * A business's Bookplus subscription (the payment specification, sections
 * 10–12). One per business owner account: who is on what, the dates, the
 * saved card and where the monthly payments stand (services/subscriptionBilling.js
 * and services/subscriptionRenewals.js).
 *
 * status:
 *   exempt      kept free: a business from before subscriptions, until it is moved
 *   trialing    in the free trial (trialEndsAt)
 *   trial_ended the trial is over and no card is saved yet
 *   active      the owner added a card and paid the first month (paidThrough);
 *               the card is saved in PayGate's vault for the monthly charges.
 *               cancelAtPeriodEnd: the owner cancelled; nothing more is
 *               charged and the plan ends at paidThrough
 *   past_due    a monthly payment did not go through: retried until
 *               retry.graceEndsAt (7 days), the business is still listed
 *   paused      still unpaid after the 7 days: the business is not shown to
 *               clients and takes no new bookings (User.billingPausedAt)
 *               until a month is paid with a card
 *   cancelled   the plan ended (cancelled, or the account was closed); the
 *               saved card is deleted at PayGate. A new plan can be started.
 *
 * The card: only PayGate's vault token (vaultId, never selected by default)
 * and what the owner is shown (brand, last 4 digits, expiry). Bookplus never
 * receives or stores a card number.
 *
 * The prices are snapshotted when the subscription starts, so a later change
 * to the plan's settings never silently changes what an existing business pays.
 */
const historySchema = new mongoose.Schema({
    at: { type: Date, default: Date.now },
    event: { type: String, required: true, maxlength: 60 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: '', maxlength: 500 },
}, { _id: false });

const subscriptionSchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    plan: { type: String, enum: ['basic'], default: 'basic' },
    status: { type: String, enum: ['exempt', 'trialing', 'trial_ended', 'active', 'past_due', 'paused', 'cancelled'], required: true },
    trialStartedAt: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },
    // Prices agreed when the subscription started (cents, NAD).
    terms: {
        trialDays: { type: Number, default: 0 },
        introMonths: { type: Number, default: 0 },
        introPriceCents: { type: Number, default: 0 },
        priceCents: { type: Number, default: 0 },
    },
    card: {
        brand: { type: String, default: null, maxlength: 30 },
        last4: { type: String, default: null, match: /^\d{4}$/ },
        expMonth: { type: Number, default: null, min: 1, max: 12 },
        expYear: { type: Number, default: null },
        savedAt: { type: Date, default: null },
    },
    vaultId: { type: String, default: null, select: false, maxlength: 64 },
    // The end of the last month paid for.
    paidThrough: { type: Date, default: null },
    // The owner's agreement to the plan terms, including the authority to
    // charge the saved card every month until cancelled: which version of the
    // Business Terms, when, and with which payment it was given.
    termsAccepted: {
        version: { type: String, default: null },
        at: { type: Date, default: null },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        paymentRef: { type: String, default: null },
    },
    // The last SubscriptionPayment applied to this record: applying a payment
    // twice (a notify and a return racing) is a no-op.
    lastPaymentRef: { type: String, default: null },
    // Cancelling: the plan runs to paidThrough, then ends; nothing more is charged.
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelRequestedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    // A monthly payment that did not go through: when, how many tries, the
    // next try, and when the plan is paused if it is still unpaid.
    retry: {
        firstFailedAt: { type: Date, default: null },
        attempts: { type: Number, default: 0 },
        nextAttemptAt: { type: Date, default: null },
        graceEndsAt: { type: Date, default: null },
    },
    pausedAt: { type: Date, default: null },
    // The 14 days' notice of a price rise (the introductory price ending),
    // given for the monthly payment due at forPaidThrough.
    priceNotice: {
        forPaidThrough: { type: Date, default: null },
        sentAt: { type: Date, default: null },
    },
    // Set while one worker charges the saved card (a claim, so two never do).
    chargingAt: { type: Date, default: null },
    // What the last applied payment was (cents): a price rise is measured from it.
    lastPriceCents: { type: Number, default: null },
    // Paid months so far (the introductory price applies while < introMonths).
    paidMonths: { type: Number, default: 0, min: 0 },
    history: { type: [historySchema], default: [] },
}, { timestamps: true });

subscriptionSchema.index({ status: 1, trialEndsAt: 1 });
subscriptionSchema.index({ status: 1, paidThrough: 1 });
subscriptionSchema.index({ status: 1, 'retry.nextAttemptAt': 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
