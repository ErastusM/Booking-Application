/**
 * What a business's subscription looks like on a given day (services/subscriptions
 * describe): days left in the trial, the trial ending, and the introductory then
 * standard price. Pure: no database.
 */
const subs = require('../../services/subscriptions');

const DAY = 24 * 60 * 60 * 1000;

describe('subscriptions.describe', () => {
    it('describe: trial days left, trial ended, and the introductory then standard price', () => {
        const now = new Date('2026-11-11T12:00:00Z');
        const terms = { trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999 };
        const trial = subs.describe({ status: 'trialing', terms, trialEndsAt: new Date(now.getTime() + 2.5 * DAY), paidMonths: 0 }, now);
        expect(trial).toMatchObject({ status: 'trialing', trialDaysLeft: 3, nextPriceCents: 6999, introMonthsLeft: 6 });
        expect(subs.describe({ status: 'trialing', terms, trialEndsAt: new Date(now.getTime() - 1000) }, now).status).toBe('trial_ended');
        expect(subs.describe({ status: 'trial_ended', terms, paidMonths: 6 }, now).nextPriceCents).toBe(14999);
        expect(subs.describe({ status: 'exempt', terms }, now)).toMatchObject({ status: 'exempt', nextPriceCents: 0, trialDaysLeft: 0 });
    });

    it('describe: the next payment, cancelling, a payment that did not go through, paused, ended', () => {
        const now = new Date('2026-11-11T12:00:00Z');
        const terms = { trialDays: 30, introMonths: 6, introPriceCents: 6999, priceCents: 14999 };
        const paidThrough = new Date('2026-12-11T12:00:00Z');
        expect(subs.describe({ status: 'active', terms, paidMonths: 2, paidThrough }, now))
            .toMatchObject({ status: 'active', nextPaymentAt: paidThrough, cancelAtPeriodEnd: false, nextPriceCents: 6999, introMonthsLeft: 4 });
        expect(subs.describe({ status: 'active', terms, paidMonths: 2, paidThrough, cancelAtPeriodEnd: true }, now))
            .toMatchObject({ nextPaymentAt: null, cancelAtPeriodEnd: true });
        const retry = { nextAttemptAt: new Date('2026-11-12T12:00:00Z'), graceEndsAt: new Date('2026-11-18T12:00:00Z') };
        expect(subs.describe({ status: 'past_due', terms, paidMonths: 2, paidThrough, retry }, now))
            .toMatchObject({ status: 'past_due', nextPaymentAt: null, nextAttemptAt: retry.nextAttemptAt, graceEndsAt: retry.graceEndsAt });
        const pausedAt = new Date('2026-11-18T12:00:00Z');
        expect(subs.describe({ status: 'paused', terms, paidMonths: 2, retry, pausedAt }, now)).toMatchObject({ status: 'paused', pausedAt, nextAttemptAt: null });
        const endedAt = new Date('2026-11-01T12:00:00Z');
        expect(subs.describe({ status: 'cancelled', terms, paidMonths: 2, endedAt }, now)).toMatchObject({ status: 'cancelled', endedAt, nextPriceCents: 6999 });
    });
});
