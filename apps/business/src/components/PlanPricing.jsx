import React, { useEffect, useState } from 'react';
import { subscriptionService } from '../services';

// What a new business pays for Bookplus, shown on the sign-up page before it
// registers (Business Subscription Terms, "Pricing transparency"): the free
// period, the introductory price and its discount, the standard monthly price,
// and the billing dates if it registers today. Nothing is shown until the
// owner of Bookplus shows plans to businesses (the API answers visible: false).

const nad = (cents) => `N$${(Number(cents || 0) / 100).toFixed(2)}`;
const pct = (n) => `${Number(n).toLocaleString('en-NA', { maximumFractionDigits: 2 })}%`;
const day = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Windhoek' });
const DAY = 24 * 60 * 60 * 1000;

/** The day `n` months after `from` (the 31st becomes the last day of a shorter month), as the API counts. */
export const addMonths = (from, n) => {
    const d = new Date(from);
    const date = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(date, last));
    return d;
};

/** The billing dates for a business registering at `now`. */
export const billingDates = (plan, now = new Date()) => {
    const trialEnds = new Date(now.getTime() + plan.trialDays * DAY);
    return { trialEnds, standardFrom: addMonths(trialEnds, plan.introMonths || 0) };
};

const PlanPricing = ({ now }) => {
    const [plan, setPlan] = useState(null);
    useEffect(() => {
        let live = true;
        subscriptionService.plan()
            .then((r) => { if (live && r.data?.data?.visible) setPlan(r.data.data); })
            .catch(() => {});
        return () => { live = false; };
    }, []);
    if (!plan) return null;
    const { trialEnds, standardFrom } = billingDates(plan, now || new Date());
    const intro = plan.introMonths > 0;
    const p = { margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55, fontFamily: 'var(--font-body)' };
    const row = { display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.4rem 0', borderTop: '1px solid var(--border)', fontSize: '0.85rem' };
    return (
        <section data-testid="plan-pricing" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem 1.1rem' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700, margin: '0 0 0.4rem', color: 'var(--charcoal)' }}>What Bookplus costs</h3>
            <p style={{ ...p, marginBottom: '0.6rem' }}>
                {plan.trialDays > 0 ? <>The first {plan.trialDays} days are free, with no card needed. </> : null}
                After that, Bookplus is a monthly subscription, paid by card in advance. You can cancel at any time.
            </p>
            <div style={row} data-testid="plan-pricing-trial">
                <span>Free until</span><strong>{day(trialEnds)}</strong>
            </div>
            {intro && (
                <div style={row} data-testid="plan-pricing-intro">
                    <span>
                        {plan.introMonths === 1 ? 'First paid month' : `First ${plan.introMonths} paid months`}, from {day(trialEnds)}
                        {plan.discountPct > 0 ? <> ({pct(plan.discountPct)} off)</> : null}
                    </span>
                    <strong>{nad(plan.introPriceCents)}{plan.introMonths === 1 ? '' : ' a month'}</strong>
                </div>
            )}
            <div style={row} data-testid="plan-pricing-standard">
                <span>Then every month, from {day(standardFrom)}</span>
                <strong>{nad(plan.priceCents)} a month</strong>
            </div>
            <p style={{ ...p, marginTop: '0.5rem', fontSize: '0.78rem' }}>
                Prices in Namibian Dollars (N$). We remind you before each payment. See the plan terms in the Terms of Service.
            </p>
        </section>
    );
};

export default PlanPricing;
