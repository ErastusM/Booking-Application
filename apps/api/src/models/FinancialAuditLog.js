const mongoose = require('mongoose');

/**
 * Every financial action, as the payment specification (section 7) lists it:
 * who did it, what, how much, for which business and booking or transaction,
 * when, why, and where its approval stands. Written only through
 * utils/financeAudit.js. Append-only: the model refuses updates and deletes,
 * so an entry can never be quietly changed after the fact.
 */
const financialAuditLogSchema = new mongoose.Schema({
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = the system
    actorRole: { type: String, default: null }, // e.g. 'director', 'finance', 'provider', 'system'
    action: { type: String, required: true, maxlength: 80 },
    amountCents: { type: Number, default: null },
    currency: { type: String, default: 'NAD', uppercase: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    reference: { type: String, default: '', maxlength: 120 },
    reason: { type: String, default: '', maxlength: 1000 },
    approvalStatus: {
        type: String,
        enum: ['not_required', 'pending', 'approved', 'rejected'],
        default: 'not_required',
    },
    // Linked request when the action went through maker-checker.
    request: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceRequest', default: null },
    // Anything else worth keeping (e.g. a settings change's before and after).
    details: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

financialAuditLogSchema.index({ createdAt: -1, _id: -1 });
financialAuditLogSchema.index({ provider: 1, createdAt: -1 });
financialAuditLogSchema.index({ action: 1, createdAt: -1 });

const refuse = function (next) {
    next(new Error('FinancialAuditLog entries are append-only'));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove']) {
    financialAuditLogSchema.pre(op, refuse);
}
financialAuditLogSchema.pre('save', function (next) {
    if (!this.isNew) return next(new Error('FinancialAuditLog entries are append-only'));
    next();
});

module.exports = mongoose.model('FinancialAuditLog', financialAuditLogSchema);
