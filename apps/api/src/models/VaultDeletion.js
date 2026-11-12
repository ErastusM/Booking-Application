const mongoose = require('mongoose');

/**
 * A saved card Bookplus has asked (or must still ask) PayGate to delete: the
 * plan ended, the card was replaced, or the account was closed. Kept as a
 * queue so a deletion PayGate could not take at the time is retried
 * (services/subscriptionRenewals.js) and every one is on record.
 *
 * vaultId is PayGate's token, never selected by default; it is cleared once
 * PayGate has deleted the card.
 */
const vaultDeletionSchema = new mongoose.Schema({
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
    vaultId: { type: String, default: null, select: false, maxlength: 64 },
    last4: { type: String, default: null },
    reason: { type: String, enum: ['plan_ended', 'card_replaced', 'account_closed'], required: true },
    status: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null, maxlength: 200 },
    nextAttemptAt: { type: Date, default: Date.now },
    doneAt: { type: Date, default: null },
}, { timestamps: true });

vaultDeletionSchema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model('VaultDeletion', vaultDeletionSchema);
