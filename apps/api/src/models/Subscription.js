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
    status: { type: String, enum: ['exempt', 'trialing', 'trial_ended'], required: true },
    trialStartedAt: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },
    // Prices agreed when the subscription started (cents, NAD).
    terms: {
        trialDays: { type: Number, default: 0 },
        introMonths: { type: Number, default: 0 },
        introPriceCents: { type: Number, default: 0 },
        priceCents: { type: Number, default: 0 },
    },
    // Paid months so far (the introductory price applies while < introMonths).
    paidMonths: { type: Number, default: 0, min: 0 },
    history: { type: [historySchema], default: [] },
}, { timestamps: true });

subscriptionSchema.index({ status: 1, trialEndsAt: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
