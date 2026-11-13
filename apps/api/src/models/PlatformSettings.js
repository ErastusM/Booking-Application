const mongoose = require('mongoose');

/**
 * Bookplus's own pricing settings: the business subscription plan (Bookplus
 * takes card payments only for business subscriptions; no booking payments
 * and no commission). One document (key 'platform'). Every value is editable
 * by a director in the admin panel; every change is written to
 * FinancialAuditLog with the before and after values.
 *
 * Money is integer cents (NAD). Older documents may still hold fields from
 * booking payments (commission, payouts); they are no longer read.
 */
const planSchema = new mongoose.Schema({
    label: { type: String, required: true, trim: true, maxlength: 40 },
    // Subscription (Basic): a free trial, then introductory months, then the standard price.
    trialDays: { type: Number, default: 0, min: 0, max: 365 },
    introMonths: { type: Number, default: 0, min: 0, max: 60 },
    introPriceCents: { type: Number, default: 0, min: 0 },
    priceCents: { type: Number, default: 0, min: 0 },
    // How many days before the standard price starts the business is told.
    priceChangeNoticeDays: { type: Number, default: 14, min: 0, max: 90 },
}, { _id: false });

const platformSettingsSchema = new mongoose.Schema({
    key: { type: String, default: 'platform', unique: true },
    plans: {
        basic: { type: planSchema, required: true },
    },
    vat: {
        registered: { type: Boolean, default: false },
        number: { type: String, default: '', trim: true, maxlength: 40 }, // never invented
        ratePct: { type: Number, default: 15, min: 0, max: 100 },
    },
    // The go-live gates that can only be confirmed by a person (who, when).
    launch: {
        providerApproved: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
        pricingApproved: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
        legalCleared: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
        termsReviewed: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
        liveTestPassed: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, note: { type: String, default: '' } },
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

// The specification's starting values (section 15).
platformSettingsSchema.statics.DEFAULTS = Object.freeze({
    plans: {
        basic: {
            label: 'Basic', trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999,
            priceChangeNoticeDays: 14,
        },
    },
});

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);
