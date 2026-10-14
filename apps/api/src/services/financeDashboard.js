/**
 * The finance dashboard (payment specification, section 15): how Bookplus's
 * online payments business is doing over a period.
 *
 *   businesses   how many are approved and taking payments, on each plan, and
 *                (Basic) in their free trial or introductory months
 *   revenue      what Bookplus kept: commission and fixed fees (net of what
 *                refunds handed back), by plan; subscriptions from Phase 5
 *   costs        card processing (paid to PayGate, and how much businesses
 *                bore), Bookplus's own cost per booking, chargebacks lost and
 *                recovered, refunds (volume), and the monthly costs a
 *                director enters by hand
 *   results      net contribution overall, per business, per booking-value
 *                band and per plan; minimum and average net per booking;
 *                break-even progress against the monthly costs
 *
 * Revenue and net contribution are kept apart, as the specification asks. Each
 * booking's net is pricing.bookplusNetFor, the same formula as the simulator,
 * applied to the commission actually kept after refunds.
 */
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const LedgerEntry = require('../models/LedgerEntry');
const Dispute = require('../models/Dispute');
const User = require('../models/User');
const OperatingCost = require('../models/OperatingCost');
const pricing = require('./pricing');
const { canTakePayments } = require('./paymentsApproval');

// Windhoek is UTC+2 all year: a day or month is counted in local time.
const OFFSET_MS = 2 * 60 * 60 * 1000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const localYmd = (d) => new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
const startOfDay = (ymd) => new Date(new Date(`${ymd}T00:00:00.000Z`).getTime() - OFFSET_MS);
const endOfDay = (ymd) => new Date(new Date(`${ymd}T23:59:59.999Z`).getTime() - OFFSET_MS);

/** The period asked for, or this month so far. Returns null when it makes no sense. */
const periodOf = (fromQ, toQ, now = new Date()) => {
    const today = localYmd(now);
    const from = YMD.test(fromQ || '') ? fromQ : `${today.slice(0, 7)}-01`;
    const to = YMD.test(toQ || '') ? toQ : today;
    if (Number.isNaN(startOfDay(from).getTime()) || Number.isNaN(endOfDay(to).getTime()) || from > to) return null;
    // At most two years in one view.
    if (endOfDay(to).getTime() - startOfDay(from).getTime() > 731 * 86400000) return null;
    return { from, to, start: startOfDay(from), end: endOfDay(to) };
};

/** Every YYYY-MM the period touches. */
const monthsIn = (from, to) => {
    const out = [];
    let [y, m] = from.slice(0, 7).split('-').map(Number);
    const [ty, tm] = to.slice(0, 7).split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }
    return out;
};

// Booking-value bands (N$), for "profitability by booking value".
const BANDS = [
    { key: 'under_100', label: 'Under N$100', min: 0, max: 10000 },
    { key: '100_199', label: 'N$100 to N$199', min: 10000, max: 20000 },
    { key: '200_499', label: 'N$200 to N$499', min: 20000, max: 50000 },
    { key: '500_999', label: 'N$500 to N$999', min: 50000, max: 100000 },
    { key: '1000_up', label: 'N$1,000 and more', min: 100000, max: Infinity },
];

const blankGroup = () => ({ bookings: 0, valueCents: 0, commissionCents: 0, netCents: 0, minNetCents: null, negativeBookings: 0 });
const addTo = (g, b) => {
    g.bookings += 1;
    g.valueCents += b.amountCents;
    g.commissionCents += b.commissionCents;
    g.netCents += b.netCents;
    g.minNetCents = g.minNetCents === null ? b.netCents : Math.min(g.minNetCents, b.netCents);
    if (b.netCents < 0) g.negativeBookings += 1;
};
const finish = (g) => ({ ...g, averageNetCents: g.bookings ? Math.round(g.netCents / g.bookings) : null });

/** Basic plan: in its free trial, or its introductory months, counted from when it was chosen. */
const basicStage = (pricingDoc, basic, now) => {
    const at = pricingDoc?.planAssignedAt ? new Date(pricingDoc.planAssignedAt) : null;
    if (!at) return null;
    const trialEnd = new Date(at.getTime() + (basic.trialDays || 0) * 86400000);
    if (now < trialEnd) return 'trial';
    const introEnd = new Date(trialEnd);
    introEnd.setMonth(introEnd.getMonth() + (basic.introMonths || 0));
    return now < introEnd ? 'intro' : 'standard_price';
};

const businessesSummary = async (settings, now) => {
    const approved = await User.find({ role: 'provider', 'paymentsApproval.status': 'approved' })
        .select('+paymentsApproval pricing').lean();
    const out = {
        approved: approved.length,
        takingPayments: 0,
        byPlan: { basic: 0, standard: 0, none: 0 },
        basicInTrial: 0,
        basicIntroPrice: 0,
    };
    for (const u of approved) {
        if (canTakePayments(u.paymentsApproval)) out.takingPayments += 1;
        const plan = u.pricing?.plan || null;
        out.byPlan[plan || 'none'] += 1;
        if (plan === 'basic') {
            const stage = basicStage(u.pricing, settings.plans?.basic || {}, now);
            if (stage === 'trial') out.basicInTrial += 1;
            if (stage === 'intro') out.basicIntroPrice += 1;
        }
    }
    return out;
};

/**
 * The whole dashboard for a period (see periodOf).
 */
const dashboard = async ({ period, now = new Date() }) => {
    const settings = await pricing.getSettings();
    const { start, end } = period;

    // Bookings paid online in the period, and what refunds handed back of
    // Bookplus's commission and fixed fee on them (whenever that happened).
    const paid = await Payment.find({ status: { $in: Payment.SETTLED }, paidAt: { $gte: start, $lte: end } })
        .select('provider amountCents fees').lean();
    const ids = paid.map((p) => p._id);
    const returnedRows = ids.length
        ? await LedgerEntry.aggregate([
            { $match: { payment: { $in: ids }, type: { $in: ['commission', 'fixed_fee'] }, amountCents: { $gt: 0 } } },
            { $group: { _id: '$payment', cents: { $sum: '$amountCents' } } },
        ])
        : [];
    const returned = new Map(returnedRows.map((r) => [String(r._id), r.cents]));

    const total = blankGroup();
    const bands = BANDS.map((b) => ({ key: b.key, label: b.label, ...blankGroup() }));
    const plans = { basic: blankGroup(), standard: blankGroup(), none: blankGroup() };
    const perBusiness = new Map();
    let processingCostCents = 0;
    let processingRecoveredCents = 0;
    let commissionExVatCents = 0;
    for (const p of paid) {
        const fees = p.fees || { commissionCents: 0, processingFeeCents: 0, processingFeePayer: 'business', plan: null };
        const commissionCents = Math.max(0, (fees.commissionCents || 0) - (returned.get(String(p._id)) || 0));
        const netCents = pricing.bookplusNetFor({ ...fees, commissionCents }, settings);
        const vat = settings.vat || {};
        commissionExVatCents += vat.registered && vat.ratePct > 0 ? Math.round(commissionCents / (1 + vat.ratePct / 100)) : commissionCents;
        processingCostCents += fees.processingFeeCents || 0;
        if (fees.processingFeePayer !== 'bookplus') processingRecoveredCents += fees.processingFeeCents || 0;
        const b = { amountCents: p.amountCents, commissionCents, netCents };
        addTo(total, b);
        addTo(bands[BANDS.findIndex((x) => p.amountCents >= x.min && p.amountCents < x.max)], b);
        addTo(plans[fees.plan === 'basic' || fees.plan === 'standard' ? fees.plan : 'none'], b);
        const key = String(p.provider);
        if (!perBusiness.has(key)) perBusiness.set(key, blankGroup());
        addTo(perBusiness.get(key), b);
    }

    // Money given back to clients in the period (all bookings), as volume.
    const ledgerSum = async (type) => {
        const [r] = await LedgerEntry.aggregate([
            { $match: { type, createdAt: { $gte: start, $lte: end } } },
            { $group: { _id: null, cents: { $sum: '$amountCents' }, n: { $sum: 1 } } },
        ]);
        return r || { cents: 0, n: 0 };
    };
    const [refunds, recovered, lostCases, costDocs, businesses] = await Promise.all([
        ledgerSum('refund'),
        ledgerSum('chargeback'),
        Dispute.find({ kind: 'chargeback', status: 'lost', closedAt: { $gte: start, $lte: end } }).select('amountCents feeCents').lean(),
        OperatingCost.find({ month: { $in: monthsIn(period.from, period.to) } }).lean(),
        businessesSummary(settings, now),
    ]);
    const chargebackLossCents = lostCases.reduce((s, d) => s + d.amountCents + (d.feeCents || 0), 0);
    const chargebackRecoveredCents = Math.abs(recovered.cents);
    const fixedCostsCents = costDocs.reduce((s, d) => s + d.items.reduce((t, i) => t + i.amountCents, 0), 0);
    const costsByCategory = {};
    for (const d of costDocs) for (const i of d.items) costsByCategory[i.category] = (costsByCategory[i.category] || 0) + i.amountCents;

    const netContributionCents = total.netCents - chargebackLossCents + chargebackRecoveredCents;
    const t = finish(total);

    // The businesses that made (or cost) Bookplus the most.
    const ranked = [...perBusiness.entries()].map(([id, g]) => ({ providerId: id, ...finish(g) }))
        .sort((a, b) => b.netCents - a.netCents);
    const shown = [...ranked.slice(0, 10), ...ranked.slice(10).filter((r) => r.netCents < 0).slice(-10)];
    const names = new Map((await User.find({ _id: { $in: shown.map((r) => new mongoose.Types.ObjectId(r.providerId)) } })
        .select('name businessProfile.businessName').lean())
        .map((u) => [String(u._id), u.businessProfile?.businessName || u.name || '']));

    return {
        period: { from: period.from, to: period.to, months: monthsIn(period.from, period.to) },
        businesses,
        revenue: {
            // What Bookplus kept from online payments (commission and fixed
            // fees, after refunds handed some back). Subscriptions: Phase 5.
            commissionCents: t.commissionCents,
            commissionExVatCents,
            vatRegistered: !!settings.vat?.registered,
            subscriptionCents: 0,
            totalCents: t.commissionCents,
            byPlan: Object.fromEntries(Object.entries(plans).map(([k, g]) => [k, finish(g).commissionCents])),
        },
        bookings: { paidOnline: t.bookings, valueCents: t.valueCents, averageValueCents: t.bookings ? Math.round(t.valueCents / t.bookings) : null },
        costs: {
            processingCostCents,
            processingRecoveredCents,
            processingBorneCents: processingCostCents - processingRecoveredCents,
            opsCostCents: t.bookings * Math.max(0, settings.opsCostPerTxCents || 0),
            opsCostPerBookingCents: Math.max(0, settings.opsCostPerTxCents || 0),
            refundsToClientsCents: Math.abs(refunds.cents),
            refunds: refunds.n,
            chargebacksLost: lostCases.length,
            chargebackLossCents,
            chargebackRecoveredCents,
            fixedCostsCents,
            fixedCostsByCategory: costsByCategory,
            fixedCostMonthsEntered: costDocs.map((d) => d.month).sort(),
        },
        results: {
            // After card processing Bookplus bears, its own cost per booking,
            // VAT on its commission, and chargebacks (lost less recovered).
            netContributionCents,
            afterFixedCostsCents: netContributionCents - fixedCostsCents,
            perBooking: { averageNetCents: t.averageNetCents, minNetCents: t.minNetCents, negativeBookings: t.negativeBookings },
            breakEven: {
                fixedCostsCents,
                coveredPct: fixedCostsCents > 0 ? Math.round((netContributionCents / fixedCostsCents) * 100) : null,
                moreBookingsNeeded: fixedCostsCents > netContributionCents && t.averageNetCents > 0
                    ? Math.ceil((fixedCostsCents - netContributionCents) / t.averageNetCents)
                    : 0,
            },
            byBand: bands.map(finish),
            byPlan: Object.fromEntries(Object.entries(plans).map(([k, g]) => [k, finish(g)])),
            businesses: {
                count: ranked.length,
                negative: ranked.filter((r) => r.netCents < 0).length,
                rows: shown.map((r) => ({ ...r, businessName: names.get(r.providerId) || '' })),
            },
        },
    };
};

module.exports = { dashboard, periodOf, monthsIn, BANDS, basicStage };
