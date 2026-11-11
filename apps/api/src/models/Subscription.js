const mongoose = require('mongoose');

/**
 * A business's Bookplus subscription (the payment specification, sections
 * 10–12). One per business owner account. Billing itself (saving a card,
 * monthly charges, the grace period) comes later; this records who is on what,
 * and the dates.
 *
 * status:
 *   exempt      kept free: a business from before subscriptions, until it is moved
 *   trialing    in the free trial (trialEndsAt)
 *   trial_ended the trial is over and no card is saved yet
 *   active      the owner added a card and paid the first month (paidThrough);
 *               the card is saved in PayGate's vault for the monthly charges
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
    status: { type: String, enum: ['exempt', 'trialing', 'trial_ended', 'active'], required: true },
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
    // Paid months so far (the introductory price applies while < introMonths).
    paidMonths: { type: Number, default: 0, min: 0 },
    history: { type: [historySchema], default: [] },
}, { timestamps: true });

subscriptionSchema.index({ status: 1, trialEndsAt: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
