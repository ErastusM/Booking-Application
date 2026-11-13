const mongoose = require('mongoose');

/**
 * Bookplus's own pricing and money settings (the owner's payment specification,
 * October 2026). One document (key 'platform'). Every value is editable by a
 * director in the admin panel; every change is written to FinancialAuditLog
 * with the before and after values. Nothing here is hard-coded elsewhere.
 *
 * Money is integer cents (NAD). Percentages are basis points (150 = 1.5%).
 * `null` means "not known yet": the processing fee and chargeback fee stay
 * null until PayGate confirms Bookplus's actual Namibian fees, and the launch
 * checklist reports them as missing.
 */
const planSchema = new mongoose.Schema({
    label: { type: String, required: true, trim: true, maxlength: 40 },
    // Subscription (Basic): a free trial, then introductory months, then the standard price.
    trialDays: { type: Number, default: 0, min: 0, max: 365 },
    introMonths: { type: Number, default: 0, min: 0, max: 60 },
    introPriceCents: { type: Number, default: 0, min: 0 },
    priceCents: { type: Number, default: 0, min: 0 },
    // How many days before the standard price starts the business is told.
    priceChangeNoticeDays: { type: Number, default: 30, min: 0, max: 90 },
    // Commission on each eligible online booking.
    commissionBps: { type: Number, required: true, min: 0, max: 10000 },
    fixedFeeCents: { type: Number, default: 0, min: 0 },
}, { _id: false });

const platformSettingsSchema = new mongoose.Schema({
    key: { type: String, default: 'platform', unique: true },
    plans: {
        basic: { type: planSchema, required: true },
        standard: { type: planSchema, required: true },
    },
    // The payment provider's fee on each card payment, and who bears it.
    processingFee: {
        bps: { type: Number, default: null, min: 0, max: 10000 },
        fixedCents: { type: Number, default: null, min: 0 },
        payer: { type: String, enum: ['business', 'bookplus'], default: 'business' },
    },
    // The provider's fee per chargeback (unknown until confirmed).
    chargebackFeeCents: { type: Number, default: null, min: 0 },
    // Safeguards: no booking may earn Bookplus less than this, and online
    // payment is only offered on bookings of at least this much.
    minCommissionCents: { type: Number, default: 0, min: 0 },
    minOnlineBookingCents: { type: Number, default: 0, min: 0 },
    // Bookplus's own cost of handling one transaction (support, systems), for
    // the net-revenue calculation. Entered by the owner; 0 until then.
    opsCostPerTxCents: { type: Number, default: 0, min: 0 },
    payout: {
        frequency: { type: String, enum: ['weekly', 'biweekly', 'monthly'], default: 'weekly' },
        weekday: { type: Number, default: 5, min: 0, max: 6 }, // 5 = Friday
        minThresholdCents: { type: Number, default: 0, min: 0 },
    },
    vat: {
        registered: { type: Boolean, default: false },
        number: { type: String, default: '', trim: true, maxlength: 40 }, // never invented
        ratePct: { type: Number, default: 15, min: 0, max: 100 },
    },
    approvals: {
        // A refund prepared by finance above this needs a director's approval.
        refundThresholdCents: { type: Number, default: 50000, min: 0 },
        // Manual adjustments to a business's balance always need a second person.
        adjustmentsNeedApproval: { type: Boolean, default: true },
    },
    // The go-live gates that can only be confirmed by a person (who, when).
    launch: {
        providerApproved: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
        pricingApproved: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
        legalCleared: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
        termsReviewed: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
        liveTestPassed: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
        // The owner confirmed the payout schedule (weekly on Friday in the
        // specification; every two weeks was also discussed).
        payoutScheduleConfirmed: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
    },
    // Business subscriptions (services/subscriptions.js). startedAt: businesses
    // created before it are kept free until moved; set once, on the first deploy
    // with subscriptions. showToBusinesses: the "Your plan" page in the business
    // app; off until the owner decides who pays.
    subscriptions: {
        startedAt: { type: Date, default: null },
        showToBusinesses: { type: Boolean, default: false },
    },
    version: { type: Number, default: 1 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

// The starting values: Business Subscription Terms (November 2026) for Basic:
// 60 days free, then N$79.99 for the first paid month, then N$149.99 a month;
// 30 days' notice of a price revision.
platformSettingsSchema.statics.DEFAULTS = Object.freeze({
    plans: {
        basic: {
            label: 'Basic', trialDays: 60, introMonths: 1, introPriceCents: 7999, priceCents: 14999,
            priceChangeNoticeDays: 30, commissionBps: 150, fixedFeeCents: 0,
        },
        standard: {
            label: 'Standard', trialDays: 0, introMonths: 0, introPriceCents: 0, priceCents: 0,
            priceChangeNoticeDays: 14, commissionBps: 300, fixedFeeCents: 150,
        },
    },
});

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);
