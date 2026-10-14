import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, XCircle, Clock } from 'lucide-react';
import { paymentsService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { goToPayGate, lastPayment, nad } from '../utils/payOnline';

// /booking/payment?ref=… — where PayGate sends the client back after paying
// (through the API, which checks the payment with PayGate itself). It asks the
// API for the payment's state until it settles: paid (the booking is
// confirmed), not paid (try again while the time is still held), or the time
// ran out. Nothing here trusts the address bar: the state always comes from
// the API, which asked PayGate.

const POLL_MS = 3000;
const POLL_FOR_MS = 2 * 60 * 1000;
const PAID = ['paid', 'partially_refunded', 'refunded', 'refund_pending'];
const OPEN = ['initiated', 'pending'];

const when = (a) => {
    if (!a?.appointmentDate) return '';
    const d = new Date(a.appointmentDate);
    const day = d.toLocaleDateString('en-NA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    return `${day}, ${a.startTime}`;
};

const PaymentResult = () => {
    const [params] = useSearchParams();
    const ref = params.get('ref') || lastPayment();
    const { user } = useAuthContext();
    const [s, setS] = useState(null);
    const [error, setError] = useState('');
    const [stillChecking, setStillChecking] = useState(false);
    const [retrying, setRetrying] = useState(false);
    // Bumped by "Check again": polls for another two minutes.
    const [round, setRound] = useState(0);
    const started = useRef(Date.now());

    const check = useCallback(async () => {
        try {
            const res = await paymentsService.status(ref);
            setS(res.data.data);
            setError('');
            return res.data.data;
        } catch (err) {
            setError(err?.response?.status === 404 ? 'not_found' : 'unreachable');
            return null;
        }
    }, [ref]);

    useEffect(() => {
        if (!ref) { setError('not_found'); return undefined; }
        started.current = Date.now();
        setStillChecking(false);
        let timer;
        let stop = false;
        const tick = async () => {
            const data = await check();
            if (stop) return;
            const open = !data || OPEN.includes(data.status);
            if (open && Date.now() - started.current < POLL_FOR_MS) timer = setTimeout(tick, POLL_MS);
            else if (open) setStillChecking(true);
        };
        tick();
        return () => { stop = true; clearTimeout(timer); };
    }, [ref, check, round]);

    const retry = async () => {
        setRetrying(true);
        try {
            const res = await paymentsService.retry(ref);
            goToPayGate(res.data.payment);
        } catch (err) {
            setRetrying(false);
            setError('');
            setS((x) => ({ ...(x || {}), canRetry: false, retryMessage: err?.response?.data?.message || 'Paying again did not work. Please book again.' }));
        }
    };

    const a = s?.appointment;
    const cancelled = a?.status === 'cancelled';
    let view = 'checking';
    if (error === 'not_found') view = 'not_found';
    // The booking decides first: money taken for a booking that is not going
    // ahead (paid after the time ran out, or cancelled since) is being refunded.
    else if (s && PAID.includes(s.status) && cancelled) view = 'refunding';
    else if (s && PAID.includes(s.status)) view = 'paid';
    else if (s && (s.status === 'expired' || cancelled)) view = 'expired';
    else if (s && ['failed', 'cancelled'].includes(s.status)) view = 'failed';

    const VIEW = {
        checking: { Icon: Clock, color: 'var(--text-secondary)', title: 'Checking your payment', text: stillChecking ? 'This is taking longer than usual. Your bank may still be confirming it.' : 'One moment while we confirm it with the card processor.' },
        paid: { Icon: CheckCircle, color: '#0e7a4f', title: 'Paid and booked', text: '' },
        failed: { Icon: XCircle, color: '#991b1b', title: 'The payment did not go through', text: 'Nothing was taken. Your time is still held for a few minutes, so you can try again.' },
        expired: { Icon: Clock, color: '#92400e', title: 'The time to pay ran out', text: 'The booking was not made and nothing was taken. Please book again.' },
        refunding: {
            Icon: XCircle, color: '#92400e', title: 'This booking is not going ahead',
            text: s ? `Your payment of ${nad(s.amountCents)} ${s.status === 'refunded' ? 'was refunded' : 'is being refunded'} to your card. If it was because the time to pay ran out, please book again.` : '',
        },
        not_found: { Icon: XCircle, color: '#991b1b', title: 'We could not find this payment', text: 'If money was taken, contact the business with the time of your booking.' },
    };
    const v = VIEW[view];
    const { Icon } = v;

    return (
        <div className="auth-page" style={{ minHeight: 'var(--page-min-h)', background: 'var(--off-white)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 'var(--page-hero-pad-top) 1rem 2rem' }}>
            <div style={{ width: '100%', maxWidth: '480px' }} className="fade-up" data-testid="payment-result" data-view={view}>
                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', padding: '2rem 1.5rem', textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                        {view === 'checking'
                            ? <div aria-hidden="true" style={{ width: '44px', height: '44px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                            : <Icon size={48} strokeWidth={1.5} style={{ color: v.color }} aria-hidden="true" />}
                    </div>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.5rem' }}>{v.title}</h1>
                    {v.text && <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6, margin: '0 0 1rem' }} role="status">{v.text}</p>}
                    {s?.retryMessage && <p role="alert" style={{ color: '#991b1b', fontSize: '0.9rem', margin: '0 0 1rem' }}>{s.retryMessage}</p>}

                    {a && view !== 'not_found' && (
                        <div style={{ textAlign: 'left', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.85rem 1rem', margin: '0 0 1.25rem', fontSize: '0.9rem', lineHeight: 1.6 }} data-testid="payment-booking">
                            {a.business && <div style={{ fontWeight: 600, color: 'var(--charcoal)' }}>{a.business}</div>}
                            {a.service && <div>{a.service}</div>}
                            <div>{when(a)}</div>
                            {view === 'paid' && (
                                <div style={{ marginTop: '0.4rem', color: 'var(--charcoal)' }}>
                                    {s.kind === 'deposit'
                                        ? <>Deposit paid: <strong>{nad(s.amountCents)}</strong>. The rest is paid at the appointment.</>
                                        : <>Paid in full: <strong>{nad(s.amountCents)}</strong>.</>}
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'grid', gap: '0.6rem' }}>
                        {view === 'failed' && s?.canRetry && (
                            <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={retry} disabled={retrying}>
                                {retrying ? 'Opening the payment page…' : 'Try again'}
                            </button>
                        )}
                        {view === 'checking' && stillChecking && (
                            <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => setRound((n) => n + 1)}>
                                Check again
                            </button>
                        )}
                        {view === 'paid' && (
                            user
                                ? <Link to="/appointments" className="btn-primary" style={{ width: '100%', textDecoration: 'none' }}>See my appointments</Link>
                                : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>We have emailed your confirmation with a link to manage the booking.</p>
                        )}
                        {['failed', 'expired', 'not_found', 'refunding'].includes(view) && (
                            <Link to="/" className={view === 'failed' && s?.canRetry ? 'btn-outline' : 'btn-primary'} style={{ width: '100%', textDecoration: 'none' }}>Back to Bookplus</Link>
                        )}
                    </div>
                </div>
            </div>
            <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
        </div>
    );
};

export default PaymentResult;
