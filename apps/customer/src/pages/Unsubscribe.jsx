import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MailX, MailCheck } from 'lucide-react';
import { marketingService } from '../services';

// One-click unsubscribe from Bookplus marketing email ("Book again" reminders and
// offers). Opened from the link in the email footer — no sign-in: the signed
// token in the URL is the only credential. Opening the page IS the click: it
// unsubscribes straight away, then offers an undo. Booking confirmations and
// reminders are not marketing and keep coming.
const Unsubscribe = () => {
    const { token } = useParams();
    const [state, setState] = useState('working'); // working | unsubscribed | subscribed | error
    const [message, setMessage] = useState('');
    const ran = useRef(false);

    useEffect(() => {
        if (ran.current) return; // StrictMode double-mount
        ran.current = true;
        marketingService.unsubscribe(token)
            .then(() => setState('unsubscribed'))
            .catch((err) => { setState('error'); setMessage(err.response?.data?.message || 'We couldn’t process this link. Please try again.'); });
    }, [token]);

    const undo = async () => {
        setState('working');
        try { await marketingService.resubscribe(token); setState('subscribed'); }
        catch (err) {
            // Never opted in: they stay unsubscribed; explain rather than erroring.
            if (err.response?.data?.code === 'never_opted_in') { setState('unsubscribed'); setMessage(err.response.data.message); return; }
            setState('error'); setMessage(err.response?.data?.message || 'Could not update your preference.');
        }
    };

    const card = { width: '100%', maxWidth: '440px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2rem', textAlign: 'center' };
    const h = { fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0.75rem 0 0.5rem' };
    const p = { color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6, margin: '0 0 1.25rem', fontFamily: 'var(--font-body)' };

    return (
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'calc(56px + 1.5rem) 1rem 2rem', background: 'var(--off-white)' }}>
            <div style={card} data-testid="unsubscribe-card" data-state={state}>
                {state === 'working' && <p style={p}>One moment…</p>}
                {state === 'unsubscribed' && (
                    <>
                        <MailX size={44} strokeWidth={1.5} style={{ color: 'var(--gold)' }} />
                        <h1 style={h}>You’re unsubscribed</h1>
                        <p style={p}>You won’t get Bookplus offers or “Book again” reminders any more. Emails about your bookings — confirmations, reminders and changes — still arrive as normal.</p>
                        {message
                            ? <p role="status" style={p}>{message}</p>
                            : <button type="button" className="btn-outline" onClick={undo} data-testid="unsubscribe-undo" style={{ padding: '0.6rem 1.2rem' }}>Undo — keep me subscribed</button>}
                    </>
                )}
                {state === 'subscribed' && (
                    <>
                        <MailCheck size={44} strokeWidth={1.5} style={{ color: 'var(--gold)' }} />
                        <h1 style={h}>You’re subscribed again</h1>
                        <p style={p}>You can switch these emails off any time from the link in the email or your account settings.</p>
                    </>
                )}
                {state === 'error' && (
                    <>
                        <h1 style={h}>Link not recognised</h1>
                        <p style={p}>{message}</p>
                        <p style={p}>If you have an account, you can turn marketing email off in <Link to="/profile" style={{ color: 'var(--gold-dark)' }}>your profile</Link>.</p>
                    </>
                )}
                <Link to="/" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontFamily: 'var(--font-body)' }}>Go to Bookplus</Link>
            </div>
        </div>
    );
};

export default Unsubscribe;
