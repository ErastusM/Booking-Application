import React, { useEffect, useState } from 'react';
import { walletService } from '../services';
import { uploadProof } from '../utils/uploadImage';
import { useToast } from './Toast';
import { useModalChrome } from '../hooks/useModalChrome';
import { currencySymbol } from '../utils/currency';
import { X, Upload, Check, Info } from 'lucide-react';
import { Field } from '@bookplus/ui';
import WalletRules, { walletRulesNeedAck } from './WalletRules';

const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.4rem' };
const newRef = () => `BP-${Math.floor(10000 + Math.random() * 89999)}`;

// Submit a wallet top-up request (amount + proof of payment) to a provider.
// Reused by the client wallet page and every provider profile — both already know
// the provider's pricing currency, so pass it in (`currency` is optional; the API's
// own getMyWalletWithProvider response doesn't carry it, see comment below).
const WalletTopUpModal = ({ providerId, providerName, currency, onClose, onDone }) => {
    const [amount, setAmount] = useState('');
    const [reference, setReference] = useState(newRef());
    const [proof, setProof] = useState(null); // { ref, kind } once uploaded (private)
    const [uploading, setUploading] = useState(false);
    const [instructions, setInstructions] = useState('');
    // The business's wallet rules, disclosed BEFORE the client pays. null until
    // loaded; a top-up can't be sent until they are known (and, when the money is
    // non-refundable or can expire, acknowledged).
    const [rules, setRules] = useState(null);
    const [rulesError, setRulesError] = useState(false);
    const [understood, setUnderstood] = useState(false);
    const [method, setMethod] = useState('manual');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const toast = useToast();
    const cur = currencySymbol(currency);

    // Escape-to-close + body scroll lock + initial focus. Guard close while a
    // submit is in flight so Escape can't abandon an in-progress request.
    const panelRef = useModalChrome(() => { if (!busy) onClose(); });

    useEffect(() => {
        if (!providerId) return;
        walletService.getMyWalletWithProvider(providerId)
            .then((res) => {
                const s = res.data.data?.settings || {};
                setInstructions(s.paymentInstructions || '');
                setRules({ refundsAllowed: s.refundsAllowed !== false, expiryMonths: s.expiryMonths || null });
            })
            .catch(() => setRulesError(true));
    }, [providerId]);

    const needsAck = walletRulesNeedAck(rules);
    const rulesReady = !!rules && (!needsAck || understood);

    const handleProof = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true); setError('');
        try { setProof(await uploadProof(file)); }
        catch (err) { setError(err?.message || 'Could not upload that file — try again.'); }
        finally { setUploading(false); }
    };

    const submit = async (e) => {
        e.preventDefault();
        const amt = parseFloat(amount);
        if (!(amt > 0)) { setError('Enter a valid amount'); return; }
        if (!rules) { setError('We couldn’t load this business’s wallet rules. Close this window and try again.'); return; }
        if (needsAck && !understood) { setError('Please confirm you understand this business’s wallet rules.'); return; }
        setBusy(true); setError('');
        try {
            await walletService.topUp({ providerId, amount: amt, reference, proof: proof?.ref, method, rulesAcknowledged: needsAck ? understood : false });
            toast('Top-up request sent — awaiting the provider’s confirmation.', 'success');
            onDone();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not submit top-up');
            setBusy(false);
        }
    };

    const isPdf = proof?.kind === 'pdf';

    return (
        <div onClick={() => { if (!busy && !uploading) onClose(); }} className="scrim-in" style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
            <div ref={panelRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="scale-in" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '440px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(4,5,5,0.3)', outline: 'none' }}>
                <div style={{ padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Top up · {providerName}</h2>
                    <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
                </div>
                <form onSubmit={submit} style={{ padding: '1.25rem' }}>
                    {/* Funding method — card via DPO is parked until the gateway is live */}
                    <div id="topup-method-label" style={labelStyle}>Funding method</div>
                    <div role="group" aria-labelledby="topup-method-label" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
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

                    {/* Wallet rules — refundable or not, and expiry — shown before paying. */}
                    <div data-testid="wallet-rules" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.85rem 1rem', marginBottom: '1rem' }}>
                        <p style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0 0 0.5rem', fontFamily: 'var(--font-display)', fontWeight: '600', fontSize: '0.92rem', color: 'var(--charcoal)' }}>
                            <Info size={16} aria-hidden="true" /> {providerName}’s wallet rules
                        </p>
                        {rules
                            ? <WalletRules rules={rules} providerName={providerName} />
                            : <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{rulesError ? 'Couldn’t load the wallet rules. Close this window and try again.' : 'Loading…'}</p>}
                        {needsAck && (
                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem', marginTop: '0.75rem', fontSize: '0.84rem', color: 'var(--charcoal)', cursor: 'pointer', lineHeight: 1.45 }}>
                                <input type="checkbox" data-testid="wallet-rules-ack" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{ marginTop: '0.2rem', width: '18px', height: '18px', flexShrink: 0, accentColor: 'var(--gold)' }} />
                                <span>I understand these rules{rules && !rules.refundsAllowed ? ', including that this balance is non-refundable' : ''}{rules?.expiryMonths ? `${rules && !rules.refundsAllowed ? ' and' : ', including that'} it expires after ${rules.expiryMonths} months without wallet activity` : ''}.</span>
                            </label>
                        )}
                    </div>

                    <Field label={<>Amount ({cur})</>} labelStyle={labelStyle}>
                        <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" className="input" style={{ width: '100%', marginBottom: '1rem' }} required />
                    </Field>

                    <Field label="Payment reference" labelStyle={labelStyle}>
                        <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} className="input" style={{ width: '100%', marginBottom: '1rem' }} />
                    </Field>

                    {method !== 'cash' && (
                        <>
                            <div id="topup-proof-label" style={labelStyle}>Proof of payment (optional — image or PDF)</div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1rem', border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: proof ? 'var(--gold-dark)' : 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                                {proof ? <Check size={16} /> : <Upload size={16} />}
                                {uploading ? 'Uploading…' : proof ? (isPdf ? 'PDF uploaded — tap to replace' : 'Proof uploaded — tap to replace') : 'Upload a screenshot, receipt or PDF'}
                                <input type="file" accept="image/*,application/pdf" onChange={handleProof} className="sr-only" aria-labelledby="topup-proof-label" />
                            </label>
                        </>
                    )}

                    {error && <p style={{ color: 'var(--danger-fg)', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>}

                    <button type="submit" data-testid="topup-submit" disabled={busy || uploading || !rulesReady} className="btn-primary" style={{ width: '100%', padding: '0.85rem' }}>
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
