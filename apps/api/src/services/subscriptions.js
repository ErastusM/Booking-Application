/**
 * Business subscriptions (the payment specification, sections 10–12): who is
 * kept free, who is in a trial, and when it ends. Payments are in
 * services/subscriptionBilling.js and services/subscriptionRenewals.js.
 *
 *  - A business created before subscriptions started (settings
 *    subscriptions.startedAt) is kept free until a director moves it.
 *  - A business created after starts its free trial at sign-up: the Basic
 *    plan's trial, introductory and standard prices are snapshotted then.
 */
const Subscription = require('../models/Subscription');
const PlatformSettings = require('../models/PlatformSettings');
const User = require('../models/User');
const VaultDeletion = require('../models/VaultDeletion');
const pricing = require('./pricing');

const DAY = 24 * 60 * 60 * 1000;

/** The day a month after `from` (the 31st becomes the last day of a shorter month). */
const addMonth = (from) => {
    const d = new Date(from);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d;
};

/**
 * Months unpaid: from the date the plan is paid to, how many months have
 * started by now (Business Subscription Terms, "Subscription continuity": a
 * suspension does not cancel what is owed). 0 when paid up.
 */
const unpaidMonths = (paidThrough, now = new Date()) => {
    if (!paidThrough) return 0;
    let n = 0;
    for (let d = new Date(paidThrough); d <= now && n < 120; d = addMonth(d)) n += 1;
    return n;
};

/** When subscriptions started (set once, the first time it is asked). */
const startedAt = async (now = new Date()) => {
    const settings = await pricing.getSettings();
    if (settings.subscriptions?.startedAt) return new Date(settings.subscriptions.startedAt);
    await PlatformSettings.updateOne(
        { key: 'platform', 'subscriptions.startedAt': { $in: [null] } },
        { $set: { 'subscriptions.startedAt': now } },
    );
    pricing.invalidateSettings();
    const fresh = await pricing.getSettings({ fresh: true });
    return new Date(fresh.subscriptions.startedAt);
};

const termsFrom = (plan) => ({
    trialDays: plan.trialDays || 0,
    introMonths: plan.introMonths || 0,
    introPriceCents: plan.introPriceCents || 0,
    priceCents: plan.priceCents || 0,
});

/** What a business sees and an admin lists, worked out from the record. Pure. */
const describe = (sub, now = new Date()) => {
    let { status } = sub;
    if (status === 'trialing' && sub.trialEndsAt && new Date(sub.trialEndsAt) <= now) status = 'trial_ended';
    const t = sub.terms || {};
    const introLeft = Math.max(0, (t.introMonths || 0) - (sub.paidMonths || 0));
    const nextPriceCents = introLeft > 0 ? t.introPriceCents : t.priceCents;
    return {
        status,
        plan: sub.plan,
        trialEndsAt: sub.trialEndsAt || null,
        trialDaysLeft: status === 'trialing' ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt) - now) / DAY)) : 0,
        terms: t,
        paidMonths: sub.paidMonths || 0,
        introMonthsLeft: introLeft,
        nextPriceCents: status === 'exempt' ? 0 : nextPriceCents,
        paidThrough: sub.paidThrough || null,
        // What the owner is shown about their saved card (never the vault token).
        card: sub.card?.last4 ? { brand: sub.card.brand || null, last4: sub.card.last4, expMonth: sub.card.expMonth || null, expYear: sub.card.expYear || null } : null,
        // The next monthly payment from the saved card (none once cancelled).
        nextPaymentAt: status === 'active' && !sub.cancelAtPeriodEnd ? sub.paidThrough || null : null,
        cancelAtPeriodEnd: status === 'active' && !!sub.cancelAtPeriodEnd,
        endedAt: status === 'cancelled' ? sub.endedAt || null : null,
        // A monthly payment that did not go through (past_due), or the plan paused.
        nextAttemptAt: status === 'past_due' ? sub.retry?.nextAttemptAt || null : null,
        graceEndsAt: status === 'past_due' ? sub.retry?.graceEndsAt || null : null,
        pausedAt: status === 'paused' ? sub.pausedAt || null : null,
        // Months owed while past due or paused: each is paid in turn, oldest first.
        unpaidMonths: ['past_due', 'paused'].includes(status) ? unpaidMonths(sub.paidThrough, now) : 0,
        // Clients cannot make new online bookings: unpaid month, trial ended unpaid, or no plan.
        onlineBookingsPaused: ['paused', 'trial_ended', 'cancelled'].includes(status) && !!sub.pausedAt,
    };
};

/** The business's subscription, created on first use. */
const forProvider = async (provider, now = new Date()) => {
    const existing = await Subscription.findOne({ provider: provider._id }).lean();
    if (existing) return existing;
    const since = await startedAt(now);
    const created = new Date(provider.createdAt || now);
    let doc;
    if (created < since) {
        doc = { provider: provider._id, status: 'exempt', history: [{ at: now, event: 'kept_free', note: 'Business from before subscriptions' }] };
    } else {
        const plan = (await pricing.getSettings()).plans.basic;
        const terms = termsFrom(plan);
        doc = {
            provider: provider._id, status: 'trialing', terms,
            trialStartedAt: created, trialEndsAt: new Date(created.getTime() + terms.trialDays * DAY),
            history: [{ at: now, event: 'trial_started', note: 'At sign-up' }],
        };
    }
    try {
        await Subscription.create(doc);
    } catch (err) {
        if (!(err && err.code === 11000)) throw err; // created by a parallel request
    }
    return Subscription.findOne({ provider: provider._id }).lean();
};

/** Every business owner with its subscription (records created as needed). */
const listAll = async (now = new Date()) => {
    const providers = await User.find({ role: 'provider' })
        .select('name email createdAt isActive businessProfile.businessName').sort({ createdAt: -1 }).lean();
    const out = [];
    for (const p of providers) {
        const sub = await forProvider(p, now);
        out.push({
            provider: { _id: p._id, name: p.businessProfile?.businessName || p.name, email: p.email, createdAt: p.createdAt, isActive: p.isActive !== false },
            ...describe(sub, now),
        });
    }
    return out;
};

/** Move a kept-free business onto a trial starting now (it is told first). */
const startTrial = async (providerId, { by, note = '' } = {}, now = new Date()) => {
    const provider = await User.findOne({ _id: providerId, role: 'provider' }).select('createdAt').lean();
    if (!provider) return { ok: false, code: 'not_found' };
    const sub = await forProvider(provider, now);
    if (sub.status !== 'exempt') return { ok: false, code: 'not_exempt' };
    const terms = termsFrom((await pricing.getSettings()).plans.basic);
    await Subscription.updateOne({ _id: sub._id, status: 'exempt' }, {
        $set: { status: 'trialing', terms, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + terms.trialDays * DAY) },
        $push: { history: { at: now, event: 'trial_started', by, note } },
    });
    return { ok: true, subscription: describe(await Subscription.findById(sub._id).lean(), now) };
};

/** Keep a business free (any status), e.g. a partner or a pilot. */
const keepFree = async (providerId, { by, note = '' } = {}, now = new Date()) => {
    const provider = await User.findOne({ _id: providerId, role: 'provider' }).select('createdAt').lean();
    if (!provider) return { ok: false, code: 'not_found' };
    const sub = await forProvider(provider, now);
    if (sub.status === 'exempt') return { ok: false, code: 'already_exempt' };
    if (sub.chargingAt) return { ok: false, code: 'busy' };
    // Kept free: nothing more is charged, any pause is lifted, and a saved card
    // is deleted at PayGate (services/subscriptionRenewals.js runs the queue).
    const before = await Subscription.findOneAndUpdate({ _id: sub._id, chargingAt: null }, {
        $set: {
            status: 'exempt', vaultId: null, cancelAtPeriodEnd: false, pausedAt: null, 'retry.nextAttemptAt': null,
            card: { brand: null, last4: null, expMonth: null, expYear: null, savedAt: null },
        },
        $push: { history: { at: now, event: 'kept_free', by, note } },
    }).select('+vaultId').lean();
    if (!before) return { ok: false, code: 'busy' };
    await User.updateOne({ _id: providerId }, { $set: { billingPausedAt: null } });
    if (before.vaultId) {
        await VaultDeletion.create({ provider: providerId, subscription: sub._id, vaultId: before.vaultId, last4: before.card?.last4 || null, reason: 'plan_ended' });
    }
    return { ok: true, subscription: describe(await Subscription.findById(sub._id).lean(), now) };
};

module.exports = { startedAt, addMonth, unpaidMonths, describe, forProvider, listAll, startTrial, keepFree };
