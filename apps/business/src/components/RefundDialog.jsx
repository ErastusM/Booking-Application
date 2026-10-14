import React, { useEffect, useState } from 'react';
import { onlinePaymentsService } from '../services';
import { nad, parseCents } from '../utils/onlinePayment';

// Refund a booking paid online (owner). The money goes back to the card the
// client paid with. A refund the business can't cover from its Bookplus
// balance, or above Bookplus's approval limit, is sent to Bookplus to approve
// instead; the result says which happened.
//
//   paymentId, refundableCents: what is left to refund
//   title: what is being refunded ("Thandi — Haircut")
//   onDone({ code, message }): refunded / refund_pending / approval_required
const RefundDialog = ({ paymentId, refundableCents, title, onClose, onDone }) => {
    const [amount, setAmount] = useState(((refundableCents || 0) / 100).toFixed(2));
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, busy]);

    const cents = parseCents(amount);
    const all = cents === refundableCents;

    const submit = async (e) => {
        e.preventDefault();
        if (!cents || cents <= 0) { setError('Enter the amount to refund'); return; }
        if (cents > refundableCents) { setError(`At most ${nad(refundableCents)} is left to refund`); return; }
        if (!reason.trim()) { setError('Say why, for your records and the client'); return; }
        setBusy(true); setError('');
        try {
            const res = await onlinePaymentsService.refund(paymentId, { amountCents: cents, reason: reason.trim() });
            const code = res.data?.code || 'refunded';
            onDone({ code, message: res.data?.message || 'Refund sent' });
        } catch (err) {
            setError(err?.response?.data?.message || 'The refund did not go through. Try again.');
            setBusy(false);
        }
    };

    const label = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' };
    const input = {
        width: '100%', padding: '0.65rem 0.8rem', border: '1.5px solid var(--border-input)', borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-body)', fontSize: '0.92rem', color: 'var(--text-primary)', background: 'white', boxSizing: 'border-box',
    };

    return (
        <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '1rem' }}>
            <form role="dialog" aria-modal="true" aria-labelledby="refund-title" data-testid="refund-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '420px', padding: '1.25rem', display: 'grid', gap: '0.9rem', boxSizing: 'border-box' }}>
                <div>
                    <h2 id="refund-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 600, color: 'var(--charcoal)', margin: 0 }}>Refund</h2>
                    {title && <p style={{ margin: '0.2rem 0 0', color: 'var(--text-muted)', fontSize: '0.84rem', overflowWrap: 'anywhere' }}>{title}</p>}
                </div>
                <div>
                    <label htmlFor="refund-amount" style={label}>Amount (up to {nad(refundableCents)})</label>
                    <input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} autoComplete="off" />
                </div>
                <div>
                    <label htmlFor="refund-reason" style={label}>Why</label>
                    <textarea id="refund-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...input, resize: 'vertical' }}
                        placeholder="For example: we could not do the appointment" />
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    It goes back to the card your client paid with and comes off your Bookplus balance. Bookplus gives back its commission on the refunded part{all ? ', and its fixed fee' : ''}; the card processing fee is not returned.
                    {' '}A large refund, or one bigger than your balance, is approved by Bookplus first.
                </p>
                {error && <p role="alert" style={{ margin: 0, background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>{error}</p>}
                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Refunding…' : `Refund ${cents ? nad(cents) : ''}`.trim()}</button>
                </div>
            </form>
        </div>
    );
};

export default RefundDialog;
