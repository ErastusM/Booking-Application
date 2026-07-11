import React, { useState } from 'react';
import { uploadProof } from '../../utils/uploadImage';
import { providerWalletService } from '../../services';

// Wallet dialogs extracted from ProviderDashboard.jsx. Both are fully self-
// contained (prop-driven, own their state) — they were only sitting in the main
// file for proximity.

// Provider tops up their own Bookplus account balance — pays the platform
// out-of-band and attaches proof (image or PDF) for an admin to approve.
export const ProviderAccountTopUpModal = ({ curSym, onClose, onDone }) => {
    const [amount, setAmount] = useState('');
    const [reference, setReference] = useState('');
    const [method, setMethod] = useState('manual');
    const [proofUrl, setProofUrl] = useState('');
    const [proofType, setProofType] = useState('');
    const [uploading, setUploading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const handleProof = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true); setError('');
        try { const { url, kind } = await uploadProof(file); setProofUrl(url); setProofType(kind); }
        catch { setError('Could not upload that file — try again.'); }
        finally { setUploading(false); }
    };

    const submit = async (e) => {
        e.preventDefault();
        const amt = parseFloat(amount);
        if (!(amt > 0)) { setError('Enter a valid amount'); return; }
        setBusy(true); setError('');
        try {
            await providerWalletService.submitTopUp({ amount: amt, reference, method, proofUrl, proofType });
            onDone();
        } catch (err) { setError(err.response?.data?.message || 'Could not submit'); setBusy(false); }
    };

    const lbl = { display: 'block', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.4rem' };
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '420px', maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Top up your Bookplus account</h2>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>Pay Bookplus, attach proof, and we’ll verify and credit your account.</p>
                </div>
                <form onSubmit={submit} style={{ padding: '1.25rem' }}>
                    <label style={lbl}>Funding method</label>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                        {[{ v: 'manual', t: 'Bank transfer' }, { v: 'cash', t: 'Cash' }].map((o) => (
                            <button key={o.v} type="button" onClick={() => { setMethod(o.v); if (o.v === 'cash') { setProofUrl(''); setProofType(''); } }} style={{
                                flex: 1, padding: '0.55rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.82rem',
                                border: `1.5px solid ${method === o.v ? 'var(--gold)' : 'var(--border)'}`,
                                background: method === o.v ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)', color: method === o.v ? 'var(--gold-dark)' : 'var(--text-secondary)',
                            }}>{o.t}</button>
                        ))}
                    </div>
                    <label style={lbl}>Amount ({curSym})</label>
                    <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" className="input" style={{ width: '100%', marginBottom: '1rem' }} required />
                    <label style={lbl}>Payment reference</label>
                    <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Your deposit / transfer reference" className="input" style={{ width: '100%', marginBottom: '1rem' }} />
                    {method === 'cash' ? (
                        <div style={{ background: 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            Paying in cash? No proof of payment needed — just submit and an admin will verify and credit your account.
                        </div>
                    ) : (
                        <>
                            <label style={lbl}>Proof of payment (image or PDF)</label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1rem', border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: proofUrl ? 'var(--gold-dark)' : 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                {uploading ? 'Uploading…' : proofUrl ? `${proofType === 'pdf' ? 'PDF' : 'Proof'} uploaded — tap to replace` : 'Upload a screenshot, receipt or PDF'}
                                <input type="file" accept="image/*,application/pdf" onChange={handleProof} style={{ display: 'none' }} />
                            </label>
                        </>
                    )}
                    {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>}
                    <button type="submit" disabled={busy || uploading} className="btn-primary" style={{ width: '100%', padding: '0.85rem' }}>{busy ? 'Submitting…' : 'Submit for approval'}</button>
                </form>
            </div>
        </div>
    );
};

// Provider composes a manual wallet credit/debit (or refund) for a client.
// It's proposed only — the client must approve before any balance changes.
export const WalletAdjustmentModal = ({ wallet, refundsAllowed, curSym, onClose, onSubmit }) => {
    const [direction, setDirection] = useState('credit');
    const [isRefund, setIsRefund] = useState(false);
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        const amt = parseFloat(amount);
        if (!(amt > 0)) { setError('Enter a valid amount'); return; }
        setBusy(true); setError('');
        try {
            await onSubmit({ customerId: wallet.customer?._id || wallet.customer, amount: amt, direction: isRefund ? 'credit' : direction, reason, isRefund });
        } catch (err) {
            setError(err.response?.data?.message || 'Could not propose adjustment');
            setBusy(false);
        }
    };

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '420px', boxShadow: '0 20px 60px rgba(4,5,5,0.3)', overflow: 'hidden' }}>
                <div style={{ padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Adjust wallet · {wallet.customer?.name}</h2>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>Proposed — your client approves before it applies.</p>
                </div>
                <form onSubmit={submit} style={{ padding: '1.25rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                        {[{ v: 'credit', t: 'Credit (add)' }, { v: 'debit', t: 'Debit (remove)' }].map((o) => (
                            <button key={o.v} type="button" disabled={isRefund} onClick={() => setDirection(o.v)} style={{
                                flex: 1, padding: '0.55rem', borderRadius: 'var(--radius-sm)', cursor: isRefund ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.82rem',
                                border: `1.5px solid ${!isRefund && direction === o.v ? 'var(--gold)' : 'var(--border)'}`,
                                background: !isRefund && direction === o.v ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)',
                                color: !isRefund && direction === o.v ? 'var(--gold-dark)' : 'var(--text-secondary)', opacity: isRefund ? 0.5 : 1,
                            }}>{o.t}</button>
                        ))}
                    </div>

                    {refundsAllowed && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--charcoal)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={isRefund} onChange={(e) => setIsRefund(e.target.checked)} />
                            Mark as a refund (credit)
                        </label>
                    )}

                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Amount ({curSym})</label>
                    <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 50" className="input" style={{ width: '100%', marginBottom: '1rem' }} required />

                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Reason</label>
                    <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Loyalty credit, no-show penalty" className="input" style={{ width: '100%', marginBottom: '1rem' }} maxLength={200} />

                    {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button type="submit" disabled={busy} className="btn-primary" style={{ flex: 1, padding: '0.75rem' }}>{busy ? 'Sending…' : 'Propose to client'}</button>
                        <button type="button" onClick={onClose} className="btn-outline" style={{ padding: '0.75rem 1.1rem' }}>Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    );
};
