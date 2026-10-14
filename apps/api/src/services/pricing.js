/**
 * Bookplus pricing (the owner's payment specification, October 2026): the
 * Basic and Standard plans, the commission and fixed fee on each eligible
 * online booking, the payment provider's processing fee, and what Bookplus
 * actually nets once its own costs are taken off.
 *
 * Everything comes from PlatformSettings (admin-editable); nothing is
 * hard-coded here except the arithmetic. All money is integer cents.
 *
 *   commission      = round(amount × commissionBps / 10 000) + fixedFee,
 *                     at least minCommission, never more than the amount
 *   processing fee  = round(amount × processing bps / 10 000) + processing fixed
 *                     (0 while PayGate's actual fee isn't entered)
 *   business share  = amount − commission − processing fee (when the business bears it)
 *   Bookplus net    = commission (less VAT when registered)
 *                     − processing fee (when Bookplus bears it) − ops cost per transaction
 */
const PlatformSettings = require('../models/PlatformSettings');

const PLANS = ['basic', 'standard'];
const SIM_VALUES_CENTS = [5000, 10000, 20000, 50000, 100000]; // N$50, 100, 200, 500, 1 000

const pct = (amountCents, bps) => Math.round((amountCents * (bps || 0)) / 10000);

/* ───────────────────────────── settings (cached) ───────────────────────────── */

let cache = null;
let cacheAt = 0;
// Tests clear the database between cases, so they always read it fresh.
const CACHE_MS = process.env.NODE_ENV === 'test' ? 0 : 30 * 1000;

const defaultsDoc = () => ({ key: 'platform', plans: JSON.parse(JSON.stringify(PlatformSettings.DEFAULTS.plans)) });

/** The settings document, created with the specification's values on first use. */
const getSettings = async ({ fresh = false } = {}) => {
    if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;
    let doc = await PlatformSettings.findOne({ key: 'platform' }).lean();
    if (!doc) {
        try {
            await PlatformSettings.create(defaultsDoc());
        } catch (err) {
            if (!(err && err.code === 11000)) throw err; // another request created it first
        }
        doc = await PlatformSettings.findOne({ key: 'platform' }).lean();
    }
    cache = doc;
    cacheAt = Date.now();
    return doc;
};
const invalidateSettings = () => { cache = null; cacheAt = 0; };

/* ───────────────────────────── a business's rates ───────────────────────────── */

/**
 * The commission rates that apply to a business: the rates agreed when it chose
 * its plan (snapshotted on the business, so later changes to a plan's defaults
 * never silently change an existing business), then any business-specific
 * override, then the plan's current defaults. No plan chosen → null (it can't
 * take online payments).
 */
const ratesFor = (business, settings) => {
    const pricing = business?.pricing || {};
    const plan = PLANS.includes(pricing.plan) ? pricing.plan : null;
    if (!plan) return null;
    const planDefaults = settings.plans[plan];
    const agreed = pricing.rates || {};
    const override = pricing.override || {};
    const pick = (k) => (Number.isFinite(override[k]) ? override[k] : Number.isFinite(agreed[k]) ? agreed[k] : planDefaults[k]);
    return { plan, commissionBps: pick('commissionBps'), fixedFeeCents: pick('fixedFeeCents') };
};

/* ───────────────────────────── fees on one payment ───────────────────────────── */

/**
 * The split of one online payment of `amountCents` at these rates.
 * Returns every line the statement and the ledger show.
 */
const feesFor = (amountCents, rates, settings) => {
    const amount = Math.max(0, Math.trunc(amountCents || 0));
    const percentPart = pct(amount, rates.commissionBps);
    const fixedPart = Math.max(0, Math.trunc(rates.fixedFeeCents || 0));
    let commission = percentPart + fixedPart;
    const minCommission = Math.max(0, Math.trunc(settings.minCommissionCents || 0));
    const minApplied = commission < minCommission;
    if (minApplied) commission = minCommission;
    commission = Math.min(commission, amount);

    const pf = settings.processingFee || {};
    const processingKnown = Number.isFinite(pf.bps) || Number.isFinite(pf.fixedCents);
    const processing = processingKnown ? pct(amount, pf.bps || 0) + Math.max(0, pf.fixedCents || 0) : 0;
    const businessBearsProcessing = (pf.payer || 'business') === 'business';

    const businessShare = amount - commission - (businessBearsProcessing ? processing : 0);
    return {
        amountCents: amount,
        commissionBps: rates.commissionBps,
        fixedFeeCents: fixedPart,
        percentCommissionCents: percentPart,
        commissionCents: commission, // percent part + fixed part (or the minimum)
        minCommissionApplied: minApplied,
        processingFeeCents: processing,
        processingFeeKnown: processingKnown,
        processingFeePayer: businessBearsProcessing ? 'business' : 'bookplus',
        businessShareCents: businessShare,
    };
};

/** What Bookplus keeps from one payment after its own costs (section 2). */
const bookplusNetFor = (fees, settings) => {
    const vat = settings.vat || {};
    const commissionExVat = vat.registered && vat.ratePct > 0
        ? Math.round(fees.commissionCents / (1 + vat.ratePct / 100))
        : fees.commissionCents;
    const processingByBookplus = fees.processingFeePayer === 'bookplus' ? fees.processingFeeCents : 0;
    const ops = Math.max(0, settings.opsCostPerTxCents || 0);
    return commissionExVat - processingByBookplus - ops;
};

/* ───────────────────────────── the simulator ───────────────────────────── */

/**
 * The table the specification asks for before launch: each plan at N$50, 100,
 * 200, 500 and 1 000 (or the values given). For each: what the customer pays,
 * the commission (percent and fixed parts), the processing fee, the business
 * payout, the refund and chargeback exposure, and Bookplus's net. A row with a
 * negative net is flagged: the owner must not approve the pricing while any
 * row loses money.
 *
 * Refund exposure: a full refund hands the commission back and the provider
 *   keeps its processing fee, so the most Bookplus can lose on a refund is that
 *   fee when Bookplus bears it (the business bears it otherwise).
 * Chargeback exposure: if the business can't be recovered from, Bookplus is out
 *   the amount plus the provider's chargeback fee.
 */
const simulate = (settings, values = SIM_VALUES_CENTS) => {
    const rows = [];
    for (const plan of PLANS) {
        const rates = { plan, commissionBps: settings.plans[plan].commissionBps, fixedFeeCents: settings.plans[plan].fixedFeeCents };
        for (const v of values) {
            const fees = feesFor(v, rates, settings);
            const net = bookplusNetFor(fees, settings);
            const chargebackFee = Number.isFinite(settings.chargebackFeeCents) ? settings.chargebackFeeCents : null;
            rows.push({
                plan,
                bookingCents: v,
                customerPaysCents: v,
                percentCommissionCents: fees.percentCommissionCents,
                fixedFeeCents: fees.fixedFeeCents,
                commissionCents: fees.commissionCents,
                minCommissionApplied: fees.minCommissionApplied,
                processingFeeCents: fees.processingFeeCents,
                processingFeeKnown: fees.processingFeeKnown,
                businessPayoutCents: fees.businessShareCents,
                refundExposureCents: fees.processingFeePayer === 'bookplus' ? fees.processingFeeCents : 0,
                chargebackExposureCents: chargebackFee === null ? null : v + chargebackFee,
                bookplusNetCents: net,
                belowMinimumBooking: v < (settings.minOnlineBookingCents || 0),
                negativeMargin: net < 0,
            });
        }
    }
    return {
        rows,
        processingFeeKnown: rows.every((r) => r.processingFeeKnown),
        chargebackFeeKnown: Number.isFinite(settings.chargebackFeeCents),
        anyNegative: rows.some((r) => r.negativeMargin && !r.belowMinimumBooking),
    };
};

module.exports = {
    PLANS, SIM_VALUES_CENTS,
    getSettings, invalidateSettings, ratesFor, feesFor, bookplusNetFor, simulate,
};
