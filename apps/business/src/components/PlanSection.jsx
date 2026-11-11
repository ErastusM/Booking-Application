import React from 'react';

// Account → Your plan (business owners). Shown only once Bookplus shows plans
// to businesses (admin console → Money → Subscriptions). No billing yet: it
// says where the business stands and what comes next.

const nad = (cents) => `N$${(cents / 100).toFixed(2)}`;
const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.25rem 1.4rem', marginBottom: '1rem' };
const h1 = { fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 600, color: 'var(--charcoal)', marginBottom: '0.25rem' };
const h3 = { fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.4rem' };
const p = { color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 };

const PlanSection = ({ plan }) => {
    if (!plan) return <p style={p}>Loading…</p>;
    const t = plan.terms || {};
    return (
        <div data-testid="your-plan">
            <h1 style={h1}>Your plan</h1>
            <p style={{ ...p, color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Your Bookplus subscription</p>

            {plan.status === 'exempt' && (
                <div style={card}>
                    <h3 style={h3}>Free</h3>
                    <p style={p}>You use Bookplus free of charge. If that changes, we will tell you well in advance.</p>
                </div>
            )}

            {plan.status === 'trialing' && (
                <div style={card}>
                    <h3 style={h3}>Free trial: {plan.trialDaysLeft} day{plan.trialDaysLeft === 1 ? '' : 's'} left</h3>
                    <p style={p}>Your free trial ends on {day(plan.trialEndsAt)}. Nothing is charged during the trial.</p>
                </div>
            )}

            {plan.status === 'trial_ended' && (
                <div style={card}>
                    <h3 style={h3}>Your free trial has ended</h3>
                    <p style={p}>Nothing is charged yet. We will let you know before card payments for plans start.</p>
                </div>
            )}

            {plan.status !== 'exempt' && (
                <div style={card}>
                    <h3 style={h3}>After the trial</h3>
                    <p style={p}>
                        {t.introMonths > 0
                            ? <>{nad(t.introPriceCents)} a month for the first {t.introMonths} month{t.introMonths === 1 ? '' : 's'}, then {nad(t.priceCents)} a month.</>
                            : <>{nad(t.priceCents)} a month.</>}
                        {' '}We will tell you before the price changes, and you can cancel at any time.
                    </p>
                </div>
            )}
        </div>
    );
};

export default PlanSection;
