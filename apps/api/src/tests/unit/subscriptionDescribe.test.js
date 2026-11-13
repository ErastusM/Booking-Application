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

    it('unpaid months: a pause does not cancel what is owed, counted from the date paid to', () => {
        const paidThrough = new Date('2026-10-31T12:00:00Z');
        expect(subs.unpaidMonths(paidThrough, new Date('2026-10-31T11:00:00Z'))).toBe(0);
        expect(subs.unpaidMonths(paidThrough, new Date('2026-11-05T12:00:00Z'))).toBe(1);
        // 31 October, 30 November (a shorter month), 31 December.
        expect(subs.unpaidMonths(paidThrough, new Date('2026-12-31T12:00:00Z'))).toBe(3);
        const terms = { trialDays: 60, introMonths: 1, introPriceCents: 7999, priceCents: 14999 };
        expect(subs.describe({ status: 'paused', terms, paidMonths: 1, paidThrough, pausedAt: new Date('2026-11-05T12:00:00Z') }, new Date('2026-12-01T12:00:00Z')))
            .toMatchObject({ status: 'paused', unpaidMonths: 2, nextPriceCents: 14999 });
        expect(subs.describe({ status: 'active', terms, paidMonths: 1, paidThrough: new Date('2027-01-01T00:00:00Z') }, new Date('2026-12-01T12:00:00Z')).unpaidMonths).toBe(0);
    });
});

describe('the plan clauses and the starting prices agree', () => {
    it('Business Terms PLAN_TERMS equals PlatformSettings.DEFAULTS for Basic, and the discount is right', () => {
        // Jest runs CommonJS here: read the values from the source.
        const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../../../../packages/config/legal/terms.mjs'), 'utf8');
        const block = src.match(/export const PLAN_TERMS = Object\.freeze\(\{([\s\S]*?)\}\);/)[1];
        const PLAN_TERMS = Object.fromEntries([...block.matchAll(/(\w+):\s*('?)([^,'\n]+)\2,/g)].map(([, k, q, v]) => [k, q ? v : Number(v)]));
        const basic = require('../../models/PlatformSettings').DEFAULTS.plans.basic;
        for (const k of ['trialDays', 'introMonths', 'introPriceCents', 'priceCents', 'priceChangeNoticeDays']) expect([k, basic[k]]).toEqual([k, PLAN_TERMS[k]]);
        const pct = Math.round(((basic.priceCents - basic.introPriceCents) / basic.priceCents) * 10000) / 100;
        expect(PLAN_TERMS.discountText).toBe(`${pct}%`);
    });

    it('the grace period is 5 days, with every retry inside it', () => {
        const billing = require('../../services/subscriptionBilling');
        expect(billing.GRACE_DAYS).toBe(5);
        expect(billing.RETRY_AFTER_DAYS.every((d) => d < billing.GRACE_DAYS)).toBe(true);
    });
});
