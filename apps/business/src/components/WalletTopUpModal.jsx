import React, { useEffect, useState } from 'react';
import { walletService } from '../services';
import { uploadProof } from '../utils/uploadImage';
import { X, Upload, Check } from 'lucide-react';

const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.4rem' };
const newRef = () => `BP-${Math.floor(10000 + Math.random() * 89999)}`;

// Submit a wallet top-up request (amount + proof of payment) to a provider.
// Reused by the client wallet page and every provider profile.
const WalletTopUpModal = ({ providerId, providerName, onClose, onDone }) => {
    const [amount, setAmount] = useState('');
    const [reference, setReference] = useState(newRef());
    const [proofUrl, setProofUrl] = useState('');
    const [uploading, setUploading] = useState(false);
    const [instructions, setInstructions] = useState('');
    const [method, setMethod] = useState('manual');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!providerId) return;
        walletService.getMyWalletWithProvider(providerId)
            .then((res) => setInstructions(res.data.data?.settings?.paymentInstructions || ''))
            .catch(() => {});
    }, [providerId]);

    const handleProof = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true); setError('');
        try { const { url } = await uploadProof(file); setProofUrl(url); }
        catch { setError('Could not upload that file — try again.'); }
        finally { setUploading(false); }
    };

    const submit = async (e) => {
        e.preventDefault();
        const amt = parseFloat(amount);
        if (!(amt > 0)) { setError('Enter a valid amount'); return; }
        setBusy(true); setError('');
        try {
            await walletService.topUp({ providerId, amount: amt, reference, proofUrl, method });
            onDone();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not submit top-up');
            setBusy(false);
        }
    };

    const isPdf = /\.pdf($|\?)/i.test(proofUrl);

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '440px', maxHeight: '90dvh', overflowY: 'auto', overscrollBehavior: 'contain', boxShadow: '0 20px 60px rgba(4,5,5,0.3)' }}>
                <div style={{ padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Top up · {providerName}</h2>
                    <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
                </div>
                <form onSubmit={submit} style={{ padding: '1.25rem' }}>
                    {/* Funding method — card via DPO is parked until the gateway is live */}
                    <label style={labelStyle}>Funding method</label>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                        {[{ v: 'manual', t: 'Bank transfer / deposit' }, { v: 'cash', t: 'Cash' }].map((o) => (
                            <button key={o.v} type="button" onClick={() => { setMethod(o.v); if (o.v === 'cash') setProofUrl(''); }} style={{
                                flex: '1 1 40%', padding: '0.6rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.82rem',
                                border: `1.5px solid ${method === o.v ? 'var(--gold)' : 'var(--border)'}`,
                                background: method === o.v ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)', color: method === o.v ? 'var(--gold-dark)' : 'var(--text-secondary)',
                            }}>{o.t}</button>
                        ))}
                        <button type="button" disabled title="Coming soon" style={{
                            flex: '1 1 40%', padding: '0.6rem', borderRadius: 'var(--radius-sm)', cursor: 'not-allowed', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.82rem',
                            border: '1.5px dashed var(--border)', background: 'var(--warm-gray)', color: 'var(--text-muted)',
                        }}>
                            Card (DPO)
                            <span style={{ display: 'block', fontSize: '0.62rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Coming soon</span>
                        </button>
                    </div>

                    <div style={{ background: 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {method === 'cash'
                            ? <>Pay {providerName} in cash, then submit this request. They’ll confirm receipt and your balance will update.</>
                            : instructions
                                ? <><strong style={{ color: 'var(--charcoal)' }}>How to pay {providerName}:</strong><br />{instructions.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}</>
                                : <>Pay {providerName} directly (bank transfer, eWallet, PayToday or cash deposit), then submit this request with your reference. They’ll approve it once the money arrives.</>}
                    </div>

                    <label style={labelStyle}>Amount (N$)</label>
                    <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" className="input" style={{ width: '100%', marginBottom: '1rem' }} required />

                    <label style={labelStyle}>Payment reference</label>
                    <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} className="input" style={{ width: '100%', marginBottom: '1rem' }} />

                    {method !== 'cash' && (
                        <>
                            <label style={labelStyle}>Proof of payment (optional — image or PDF)</label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1rem', border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: proofUrl ? 'var(--gold-dark)' : 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                {proofUrl ? <Check size={16} /> : <Upload size={16} />}
                                {uploading ? 'Uploading…' : proofUrl ? (isPdf ? 'PDF uploaded — tap to replace' : 'Proof uploaded — tap to replace') : 'Upload a screenshot, receipt or PDF'}
                                <input type="file" accept="image/*,application/pdf" onChange={handleProof} style={{ display: 'none' }} />
                            </label>
                        </>
                    )}

                    {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>}

                    <button type="submit" disabled={busy || uploading} className="btn-primary" style={{ width: '100%', padding: '0.85rem' }}>
                        {busy ? 'Submitting…' : 'Submit top-up request'}
                    </button>
                    <p style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.7rem 0 0' }}>
                        Your balance updates once {providerName} confirms the payment.
                    </p>
                </form>
            </div>
        </div>
    );
};

export default WalletTopUpModal;
