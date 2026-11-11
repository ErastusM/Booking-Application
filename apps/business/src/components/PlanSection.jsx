import React, { useEffect, useRef, useState } from 'react';
import { subscriptionService } from '../services';
import { goToPayGate } from '../utils/payGateRedirect';

// Account → Your plan (business owners). Shown only once Bookplus shows plans
// to businesses (admin console → Money → Subscriptions). Where the business
// stands, what comes next, and, once card payments for plans are switched on
// (the API says so with canAddCard), "Add card and start plan": the first
// month is paid on PayGate's own page, which also saves the card for the
// monthly payments. Bookplus never sees the card number.

const nad = (cents) => `N$${(cents / 100).toFixed(2)}`;
const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const expiry = (c) => (c?.expMonth && c?.expYear ? `${String(c.expMonth).padStart(2, '0')}/${c.expYear}` : '');
const apiError = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.25rem 1.4rem', marginBottom: '1rem' };
const h1 = { fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 600, color: 'var(--charcoal)', marginBottom: '0.25rem' };
const h3 = { fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.4rem' };
const p = { color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 };

// After PayGate sends the owner back: ask the API until the payment settles.
const POLL_MS = 2000;
const POLL_TRIES = 15;
const SETTLED = ['paid', 'failed', 'cancelled', 'expired'];

/** The result of a card payment the owner just came back from (?checkout=…). */
const useCheckoutResult = (reference, onPaid) => {
    const [result, setResult] = useState(reference ? { status: 'checking' } : null);
    const paidRef = useRef(onPaid);
    paidRef.current = onPaid;
    useEffect(() => {
        if (!reference) { setResult(null); return undefined; }
        let stop = false;
        let timer = null;
        let tries = 0;
        setResult({ status: 'checking' });
        const ask = async () => {
            tries += 1;
            try {
                const r = await subscriptionService.checkoutStatus(reference);
                if (stop) return;
                const status = r.data?.data?.status;
                if (SETTLED.includes(status)) {
                    setResult({ status });
                    if (status === 'paid' && paidRef.current) paidRef.current();
                    return;
                }
            } catch (err) {
                if (stop) return;
                if (err?.response?.status === 404) { setResult({ status: 'unknown' }); return; }
            }
            if (tries >= POLL_TRIES) { setResult({ status: 'slow' }); return; }
            timer = setTimeout(ask, POLL_MS);
        };
        ask();
        return () => { stop = true; clearTimeout(timer); };
    }, [reference]);
    return result;
};

const ResultNote = ({ result }) => {
    if (!result) return null;
    const text = {
        checking: ['Checking your payment', 'This takes a few seconds.'],
        paid: ['Your plan has started', 'Thank you. Your card is saved for the monthly payments.'],
        failed: ['The payment did not go through', 'Nothing was charged and no card was saved. You can try again with the same or another card.'],
        cancelled: ['The payment was cancelled', 'Nothing was charged and no card was saved.'],
        expired: ['The payment was not completed', 'Nothing was charged and no card was saved.'],
        slow: ['Your payment is still being processed', 'This page will show your plan once PayGate confirms it. You do not need to pay again.'],
        unknown: ['We could not find that payment', 'If you were charged, contact Bookplus and we will sort it out.'],
    }[result.status];
    if (!text) return null;
    return (
        <div style={{ ...card, borderColor: result.status === 'paid' ? 'var(--success)' : 'var(--border)' }} role="status" data-testid="checkout-result">
            <h3 style={h3}>{text[0]}</h3>
            <p style={p}>{text[1]}</p>
        </div>
    );
};

const PlanSection = ({ plan, checkoutRef = '', onChanged }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // "I agree" must be ticked each time; it is the authority for the monthly payments.
    const [agreed, setAgreed] = useState(false);
    const result = useCheckoutResult(checkoutRef, onChanged);
    if (!plan) return <p style={p}>Loading…</p>;
    const t = plan.terms || {};

    const addCard = async () => {
        if (!agreed) return;
        setBusy(true);
        setError('');
        try {
            const r = await subscriptionService.startCheckout(true);
            goToPayGate(r.data.data);
            // The browser is leaving for PayGate; keep the button disabled.
        } catch (err) {
            setError(apiError(err, 'Card payments are unavailable right now. Please try again in a few minutes.'));
            setBusy(false);
        }
    };

    const trialRunning = plan.status === 'trialing' && plan.trialEndsAt;
    return (
        <div data-testid="your-plan">
            <h1 style={h1}>Your plan</h1>
            <p style={{ ...p, color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Your Bookplus subscription</p>

            <ResultNote result={result} />

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
                    <p style={p}>
                        {plan.canAddCard
                            ? 'Add a card to keep using Bookplus on the Basic plan.'
                            : 'Nothing is charged yet. We will let you know before card payments for plans start.'}
                    </p>
                </div>
            )}

            {plan.status === 'active' && (
                <div style={card}>
                    <h3 style={h3}>Basic plan</h3>
                    <p style={p}>
                        {plan.paidThrough ? <>Paid to {day(plan.paidThrough)}. </> : null}
                        {plan.introMonthsLeft > 0
                            ? <>Then {nad(t.introPriceCents)} a month for {plan.introMonthsLeft} more month{plan.introMonthsLeft === 1 ? '' : 's'}, then {nad(t.priceCents)} a month.</>
                            : <>Then {nad(t.priceCents)} a month.</>}
                    </p>
                    {plan.card && (
                        <p style={{ ...p, marginTop: '0.6rem' }} data-testid="saved-card">
                            Card: {plan.card.brand || 'Card'} ending {plan.card.last4}{expiry(plan.card) ? `, expires ${expiry(plan.card)}` : ''}
                        </p>
                    )}
                </div>
            )}

            {(plan.status === 'trialing' || plan.status === 'trial_ended') && (
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

            {plan.canAddCard && result?.status !== 'paid' && result?.status !== 'checking' && (
                <div style={card} data-testid="add-card">
                    <h3 style={h3}>Start your plan</h3>
                    <p style={p}>
                        You pay {nad(plan.nextPriceCents)} now for your first month
                        {trialRunning ? <>, which starts when your free trial ends on {day(plan.trialEndsAt)}. Your trial is not shortened.</> : <>, starting today.</>}
                        {' '}You enter your card on the secure page of PayGate, our payment provider, and it is saved there for the monthly
                        payments. Bookplus never sees your card number.
                    </p>
                    <label style={{ ...p, display: 'flex', gap: '0.6rem', alignItems: 'flex-start', marginTop: '0.9rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={agreed}
                            disabled={busy}
                            onChange={(e) => setAgreed(e.target.checked)}
                            style={{ marginTop: '0.25rem', flexShrink: 0 }}
                        />
                        <span>
                            I agree to the <a href="/terms#plan" target="_blank" rel="noopener noreferrer">plan terms</a> and
                            authorise Bookplus to charge my card {nad(plan.nextPriceCents)} now and every month after that, at
                            the price of my plan at the time, until I cancel. I can cancel at any time in Your plan.
                        </span>
                    </label>
                    {error && <p style={{ ...p, color: 'var(--danger-fg)', marginTop: '0.6rem' }} role="alert">{error}</p>}
                    <button type="button" className="btn-primary" style={{ marginTop: '0.9rem' }} disabled={busy || !agreed} onClick={addCard}>
                        {busy ? 'Opening PayGate…' : 'Add card and start plan'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default PlanSection;
