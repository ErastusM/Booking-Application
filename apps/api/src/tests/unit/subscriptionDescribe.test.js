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

});
