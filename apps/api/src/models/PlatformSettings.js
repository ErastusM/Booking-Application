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
    priceChangeNoticeDays: { type: Number, default: 30, min: 0, max: 90 },
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

// The starting values: Business Subscription Terms (November 2026) for Basic:
// 60 days free, then N$79.99 for the first paid month, then N$149.99 a month;
// 30 days' notice of a price revision.
platformSettingsSchema.statics.DEFAULTS = Object.freeze({
    plans: {
        basic: {
            label: 'Basic', trialDays: 60, introMonths: 1, introPriceCents: 7999, priceCents: 14999,
            priceChangeNoticeDays: 30,
        },
    },
});

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);
