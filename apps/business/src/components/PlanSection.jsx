import React, { useEffect, useRef, useState } from 'react';
import { subscriptionService } from '../services';
import { goToPayGate } from '../utils/payGateRedirect';

// Account → Your plan (business owners). Shown only once Bookplus shows plans
// to businesses (admin console → Money → Subscriptions). Where the business
// stands and what comes next. Once card payments for plans are switched on
// (the API says what is possible: canAddCard, canChangeCard, canCancel):
//  - "Add card and start plan": the first month is paid on PayGate's own
//    page, which also saves the card for the monthly payments;
//  - "Replace card" / "Pay with another card": the next month is paid with a
//    new card on the same page, and it replaces the saved one;
//  - cancelling (and keeping the plan after all), and the payments made.
// Bookplus never sees the card number.

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
                    setResult({ status, kind: r.data?.data?.kind });
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
        paid: result.kind === 'card'
            ? ['Thank you, your payment went through', 'Your new card is saved for the monthly payments.']
            : ['Your plan has started', 'Thank you. Your card is saved for the monthly payments.'],
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

const KIND_LABEL = { first: 'First month', card: 'Paid with a new card', renewal: 'Monthly payment' };

/** The plan payments made, newest first (once there can be any). */
const usePayments = (enabled, reloadKey) => {
    const [rows, setRows] = useState(null);
    useEffect(() => {
        if (!enabled) { setRows(null); return undefined; }
        let stop = false;
        subscriptionService.payments()
            .then((r) => { if (!stop) setRows(r.data?.data || []); })
            .catch(() => { if (!stop) setRows(null); });
        return () => { stop = true; };
    }, [enabled, reloadKey]);
    return rows;
};

const Payments = ({ rows }) => {
    if (!rows || !rows.length) return null;
    const cell = { padding: '0.45rem 0.6rem 0.45rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'left' };
    return (
        <div style={card} data-testid="plan-payments">
            <h3 style={h3}>Payments</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>{['Date', 'Payment', 'Amount', 'Reference'].map((x) => <th key={x} style={{ ...cell, fontWeight: 600, color: 'var(--charcoal)' }}>{x}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.reference}>
                            <td style={cell}>{r.paidAt ? day(r.paidAt) : ''}</td>
                            <td style={cell}>{KIND_LABEL[r.kind] || 'Payment'}</td>
                            <td style={cell}>{nad(r.amountCents)}</td>
                            <td style={{ ...cell, fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>{r.reference}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

/** Paying on PayGate's page: the first month, or the next month with a new card. */
const PayWithCard = ({ plan }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // "I agree" must be ticked each time; it is the authority for the monthly payments.
    const [agreed, setAgreed] = useState(false);
    const kind = plan.checkout?.kind || 'first';
    const amount = plan.checkout?.amountCents ?? plan.nextPriceCents;
    const trialRunning = plan.status === 'trialing' && plan.trialEndsAt;

    const pay = async () => {
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

    const first = kind === 'first';
    const heading = first ? 'Start your plan' : (plan.status === 'active' ? 'Replace your card' : 'Pay with another card');
    const button = first ? 'Add card and start plan' : 'Pay with the new card';
    return (
        <div style={card} data-testid="add-card">
            <h3 style={h3}>{heading}</h3>
            <p style={p}>
                {first ? (
                    <>
                        You pay {nad(amount)} now for your first month
                        {trialRunning ? <>, which starts when your free trial ends on {day(plan.trialEndsAt)}. Your trial is not shortened.</> : <>, starting today.</>}
                    </>
                ) : (
                    <>
                        You pay {nad(amount)} now with the new card
                        {plan.status === 'active' ? <> for your next month, so your plan is paid to {day(plan.checkout.paidThroughAfter)}.</>
                            : plan.status === 'paused' ? <> for a month starting today, and clients can book you online again straight away.</>
                                : <> for the month that is unpaid, so your plan is paid to {day(plan.checkout.paidThroughAfter)}.</>}
                        {' '}The new card replaces your saved card, which we ask PayGate to delete.
                    </>
                )}
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
                    authorise Bookplus to charge my card {nad(amount)} now and every month after that, at
                    the price of my plan at the time, until I cancel. I can cancel at any time in Your plan.
                </span>
            </label>
            {error && <p style={{ ...p, color: 'var(--danger-fg)', marginTop: '0.6rem' }} role="alert">{error}</p>}
            <button type="button" className="btn-primary" style={{ marginTop: '0.9rem' }} disabled={busy || !agreed} onClick={pay}>
                {busy ? 'Opening PayGate…' : button}
            </button>
        </div>
    );
};

/** Cancelling: asked twice, saying exactly what happens. */
const CancelPlan = ({ plan, onChanged }) => {
    const [asking, setAsking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const unpaid = plan.status === 'past_due' || plan.status === 'paused';
    const cancel = async () => {
        setBusy(true);
        setError('');
        try {
            await subscriptionService.cancel();
            setAsking(false);
            if (onChanged) onChanged();
        } catch (err) {
            setError(apiError(err, 'Your plan could not be cancelled right now. Please try again.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div style={card} data-testid="cancel-plan">
            <h3 style={h3}>Cancel your plan</h3>
            {!asking ? (
                <>
                    <p style={p}>You can cancel at any time.</p>
                    <button type="button" className="btn-outline" style={{ marginTop: '0.9rem' }} onClick={() => setAsking(true)}>Cancel plan</button>
                </>
            ) : (
                <>
                    <p style={p}>
                        {unpaid
                            ? 'Your plan ends now and nothing more is charged. We ask PayGate to delete your saved card.'
                            : <>Your card will not be charged again, and your plan stays active until {day(plan.paidThrough)}, the end of the month you paid for. We do not refund part of a month already paid. After that we ask PayGate to delete your saved card.</>}
                        {plan.status === 'paused' ? ' Clients still cannot book you online until you start a plan again.' : ''}
                    </p>
                    {error && <p style={{ ...p, color: 'var(--danger-fg)', marginTop: '0.6rem' }} role="alert">{error}</p>}
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                        <button type="button" className="btn-primary" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Yes, cancel my plan'}</button>
                        <button type="button" className="btn-outline" disabled={busy} onClick={() => setAsking(false)}>Keep my plan</button>
                    </div>
                </>
            )}
        </div>
    );
};

const PlanSection = ({ plan, checkoutRef = '', onChanged }) => {
    const [keeping, setKeeping] = useState(false);
    const [keepError, setKeepError] = useState('');
    const result = useCheckoutResult(checkoutRef, onChanged);
    const hasPaid = !!plan && ['active', 'past_due', 'paused', 'cancelled'].includes(plan.status);
    const payments = usePayments(hasPaid, `${plan?.status}|${plan?.paidThrough}|${plan?.paidMonths}`);
    if (!plan) return <p style={p}>Loading…</p>;
    const t = plan.terms || {};

    const keepPlan = async () => {
        setKeeping(true);
        setKeepError('');
        try {
            await subscriptionService.keep();
            if (onChanged) onChanged();
        } catch (err) {
            setKeepError(apiError(err, 'Please try again.'));
        } finally {
            setKeeping(false);
        }
    };

    const savedCard = plan.card && (
        <p style={{ ...p, marginTop: '0.6rem' }} data-testid="saved-card">
            Card: {plan.card.brand || 'Card'} ending {plan.card.last4}{expiry(plan.card) ? `, expires ${expiry(plan.card)}` : ''}
        </p>
    );
    const offerCard = (plan.canAddCard || plan.canChangeCard) && result?.status !== 'paid' && result?.status !== 'checking';
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
                        {plan.cancelAtPeriodEnd
                            ? <>Your plan is cancelled: your card will not be charged again, and your plan ends on {day(plan.paidThrough)}.</>
                            : <>
                                {plan.nextPaymentAt ? <>Your next payment of {nad(plan.nextPriceCents)} is taken from your card on {day(plan.nextPaymentAt)}. </> : null}
                                {plan.introMonthsLeft > 0
                                    ? <>{nad(t.introPriceCents)} a month for {plan.introMonthsLeft} more month{plan.introMonthsLeft === 1 ? '' : 's'}, then {nad(t.priceCents)} a month.</>
                                    : <>{nad(t.priceCents)} a month.</>}
                            </>}
                    </p>
                    {savedCard}
                    {plan.cancelAtPeriodEnd && (
                        <>
                            {keepError && <p style={{ ...p, color: 'var(--danger-fg)', marginTop: '0.6rem' }} role="alert">{keepError}</p>}
                            <button type="button" className="btn-primary" style={{ marginTop: '0.9rem' }} disabled={keeping} onClick={keepPlan}>
                                {keeping ? 'Keeping your plan…' : 'Keep my plan'}
                            </button>
                        </>
                    )}
                </div>
            )}

            {plan.status === 'past_due' && (
                <div style={{ ...card, borderColor: 'var(--danger-fg)' }} data-testid="past-due">
                    <h3 style={h3}>Your last payment did not go through</h3>
                    <p style={p}>
                        Your payment of {nad(plan.nextPriceCents)} from your saved card did not go through.
                        {plan.nextAttemptAt ? <> We will try again on {day(plan.nextAttemptAt)}.</> : null}
                        {' '}You can pay with another card below.
                        {plan.graceEndsAt ? <> If the month is still unpaid on {day(plan.graceEndsAt)}, your plan is paused: clients cannot make new online bookings until it is paid. Your business stays listed and your information is kept.</> : null}
                    </p>
                    {savedCard}
                </div>
            )}

            {plan.status === 'paused' && (
                <div style={{ ...card, borderColor: 'var(--danger-fg)' }} data-testid="paused">
                    <h3 style={h3}>Your plan is paused</h3>
                    <p style={p}>
                        This month is unpaid, so clients cannot make new online bookings. Your business is still listed, and you can still add
                        bookings to your calendar yourself. Your bookings, clients and information are kept. Pay with a card below and online
                        bookings are back on straight away.
                    </p>
                </div>
            )}

            {plan.status === 'cancelled' && (
                <div style={card}>
                    <h3 style={h3}>Your plan has ended</h3>
                    <p style={p}>
                        {plan.endedAt ? <>Your plan ended on {day(plan.endedAt)}. </> : null}
                        Nothing more is charged. {plan.canAddCard ? 'You can start it again below.' : ''}
                    </p>
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

            {offerCard && <PayWithCard key={`${plan.status}|${plan.checkout?.kind}`} plan={plan} />}

            {plan.canCancel && <CancelPlan plan={plan} onChanged={onChanged} />}

            <Payments rows={payments} />
        </div>
    );
};

export default PlanSection;
