import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { walletService } from '../services';
import { uploadProof } from '../utils/uploadImage';
import { cloudinaryAvatar } from '../utils/cloudinary';
import { Wallet as WalletIcon, Clock, Upload, X, Check, ChevronDown, ChevronUp } from 'lucide-react';

const money = (n) => `N$${Number(n || 0).toFixed(2)}`;
const newRef = () => `BP-${Math.floor(10000 + Math.random() * 89999)}`;

// Human label + colour for a transaction row.
const describe = (t) => {
    const credit = '#15803d', debit = '#b91c1c', hold = '#b45309', muted = 'var(--text-muted)';
    switch (t.type) {
        case 'topup':
            if (t.status === 'pending') return { label: 'Top-up — awaiting approval', amount: `+${money(t.amount)}`, color: muted };
            if (t.status === 'approved') return { label: 'Top-up approved', amount: `+${money(t.amount)}`, color: credit };
            return { label: 'Top-up rejected', amount: money(t.amount), color: muted };
        case 'reservation':
            if (t.status === 'reserved') return { label: 'Reserved for booking', amount: `${money(t.amount)} held`, color: hold };
            if (t.status === 'released') return { label: 'Reservation released', amount: `${money(t.amount)} freed`, color: credit };
            return { label: 'Reservation used', amount: money(t.amount), color: muted };
        case 'deduction':
            return { label: 'Service deduction', amount: `−${money(t.amount)}`, color: debit };
        case 'refund':
            if (t.status === 'pending') return { label: 'Refund — awaiting your approval', amount: `+${money(t.amount)}`, color: muted };
            if (t.status === 'approved') return { label: 'Refund applied', amount: `+${money(t.amount)}`, color: credit };
            return { label: 'Refund declined', amount: money(t.amount), color: muted };
        case 'adjustment': {
            const isCredit = t.direction === 'credit';
            const verb = t.status === 'pending' ? '— awaiting your approval' : t.status === 'approved' ? 'applied' : 'declined';
            return {
                label: `${isCredit ? 'Credit' : 'Debit'} adjustment ${verb}`,
                amount: `${isCredit ? '+' : '−'}${money(t.amount)}`,
                color: t.status !== 'approved' ? muted : (isCredit ? credit : debit),
            };
        }
        default: return { label: t.type, amount: money(t.amount), color: muted };
    }
};

const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.4rem' };

const Wallet = () => {
    const [wallets, setWallets] = useState([]);
    const [pendingAdjustments, setPendingAdjustments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(null); // providerId whose history is open
    const [txns, setTxns] = useState({}); // providerId -> transactions
    const [topUpFor, setTopUpFor] = useState(null); // wallet object for the top-up modal
    const [busyId, setBusyId] = useState('');

    const load = useCallback(async () => {
        try {
            const [w, a] = await Promise.all([
                walletService.getMyWallets(),
                walletService.getMyPendingAdjustments(),
            ]);
            setWallets(w.data.data || []);
            setPendingAdjustments(a.data.data || []);
        } catch { /* ignore */ } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const openHistory = async (providerId) => {
        if (expanded === providerId) { setExpanded(null); return; }
        setExpanded(providerId);
        if (!txns[providerId]) {
            try {
                const res = await walletService.getMyTransactions(providerId);
                setTxns((m) => ({ ...m, [providerId]: res.data.data || [] }));
            } catch { /* ignore */ }
        }
    };

    const resolveAdjustment = async (id, approve) => {
        setBusyId(id);
        try {
            approve ? await walletService.approveAdjustment(id) : await walletService.rejectAdjustment(id);
            await load();
            setTxns({}); setExpanded(null);
        } catch (err) {
            alert(err.response?.data?.message || 'Could not update the adjustment');
        } finally { setBusyId(''); }
    };

    return (
        <div style={{ maxWidth: '860px', margin: '0 auto', padding: '2rem 1rem 4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                <WalletIcon size={26} color="var(--gold)" />
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>My Wallet</h1>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '0 0 1.75rem' }}>
                Prepaid balances you hold with your providers. Top up by paying the provider directly — they approve it and your balance updates.
            </p>

            {/* Adjustments awaiting the client's approval */}
            {pendingAdjustments.length > 0 && (
                <div style={{ marginBottom: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {pendingAdjustments.map((a) => {
                        const isCredit = a.direction === 'credit';
                        return (
                            <div key={a._id} style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid var(--gold)', borderRadius: 'var(--radius)', padding: '1rem 1.25rem' }}>
                                <p style={{ margin: '0 0 0.35rem', fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem' }}>
                                    {a.provider?.name} proposes a {isCredit ? 'credit of' : 'debit of'} <strong>{money(a.amount)}</strong>
                                </p>
                                {a.reason && <p style={{ margin: '0 0 0.6rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>“{a.reason}”</p>}
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button disabled={busyId === a._id} onClick={() => resolveAdjustment(a._id, true)} className="btn-primary" style={{ padding: '0.45rem 1.1rem', fontSize: '0.85rem' }}>
                                        <Check size={15} style={{ verticalAlign: '-2px', marginRight: '4px' }} />Approve
                                    </button>
                                    <button disabled={busyId === a._id} onClick={() => resolveAdjustment(a._id, false)} className="btn-outline" style={{ padding: '0.45rem 1.1rem', fontSize: '0.85rem' }}>Decline</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {loading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading your wallet…</div>
            ) : wallets.length === 0 ? (
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2.5rem 1.5rem', textAlign: 'center' }}>
                    <WalletIcon size={40} color="var(--text-muted)" style={{ marginBottom: '0.75rem' }} />
                    <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)', margin: '0 0 0.4rem' }}>No wallets yet</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 1.25rem' }}>
                        A wallet is created the first time you top up with a provider or book a service that requires prepayment.
                    </p>
                    <Link to="/services" className="btn-primary" style={{ textDecoration: 'none', padding: '0.6rem 1.4rem' }}>Browse providers</Link>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {wallets.map((w) => {
                        const pid = w.provider?._id || w.provider;
                        const open = expanded === pid;
                        return (
                            <div key={w._id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                <div style={{ padding: '1.25rem 1.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                                        {w.provider?.avatar
                                            ? <img src={cloudinaryAvatar(w.provider.avatar, 96)} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                                            : <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--warm-gray)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', color: 'var(--gold-dark)' }}>{(w.provider?.name || '?')[0]}</div>}
                                        <div>
                                            <p style={{ margin: 0, fontWeight: '700', color: 'var(--charcoal)' }}>{w.provider?.name || 'Provider'}</p>
                                            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>{w.provider?.providerCategory || w.provider?.businessProfile?.businessName || ''}</p>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
                                        {[
                                            { label: 'Available', val: w.availableBalance, accent: true },
                                            { label: 'Reserved', val: w.reservedBalance },
                                            { label: 'Total', val: w.totalBalance },
                                        ].map((b) => (
                                            <div key={b.label} style={{ background: b.accent ? 'rgba(201,168,76,0.1)' : 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', padding: '0.7rem 0.5rem', textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{b.label}</div>
                                                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '700', color: b.accent ? 'var(--gold-dark)' : 'var(--charcoal)' }}>{money(b.val)}</div>
                                            </div>
                                        ))}
                                    </div>

                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button onClick={() => setTopUpFor(w)} className="btn-primary" style={{ padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}>Top up</button>
                                        <button onClick={() => openHistory(pid)} className="btn-outline" style={{ padding: '0.5rem 1.1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Clock size={15} /> History {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        </button>
                                    </div>
                                </div>

                                {open && (
                                    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-sunken, var(--warm-gray))' }}>
                                        {!txns[pid] ? (
                                            <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</div>
                                        ) : txns[pid].length === 0 ? (
                                            <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No transactions yet.</div>
                                        ) : (
                                            <div>
                                                {txns[pid].map((t) => {
                                                    const d = describe(t);
                                                    return (
                                                        <div key={t._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 1.5rem', borderBottom: '1px solid var(--border)', gap: '1rem' }}>
                                                            <div style={{ minWidth: 0 }}>
                                                                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--charcoal)', fontWeight: '500' }}>{d.label}</p>
                                                                <p style={{ margin: '0.1rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                                    {new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                                    {t.reference ? ` · ${t.reference}` : ''}
                                                                </p>
                                                            </div>
                                                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                                <div style={{ fontWeight: '700', fontSize: '0.85rem', color: d.color }}>{d.amount}</div>
                                                                {t.balanceAfter?.total != null && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>bal {money(t.balanceAfter.total)}</div>}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {topUpFor && (
                <TopUpModal wallet={topUpFor} onClose={() => setTopUpFor(null)} onDone={() => { setTopUpFor(null); setTxns({}); setExpanded(null); load(); }} />
            )}
        </div>
    );
};

const TopUpModal = ({ wallet, onClose, onDone }) => {
    const providerId = wallet.provider?._id || wallet.provider;
    const [amount, setAmount] = useState('');
    const [reference, setReference] = useState(newRef());
    const [proofUrl, setProofUrl] = useState('');
    const [uploading, setUploading] = useState(false);
    const [instructions, setInstructions] = useState('');
    const [method, setMethod] = useState('manual');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
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
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '440px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(26,26,46,0.3)' }}>
                <div style={{ padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Top up · {wallet.provider?.name}</h2>
                    <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
                </div>
                <form onSubmit={submit} style={{ padding: '1.25rem' }}>
                    {/* Funding method — card via DPO is parked until the gateway is live */}
                    <label style={labelStyle}>Funding method</label>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                        {[{ v: 'manual', t: 'Bank transfer / deposit' }, { v: 'cash', t: 'Cash' }].map((o) => (
                            <button key={o.v} type="button" onClick={() => setMethod(o.v)} style={{
                                flex: '1 1 40%', padding: '0.6rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'Outfit, sans-serif', fontWeight: '600', fontSize: '0.82rem',
                                border: `1.5px solid ${method === o.v ? 'var(--gold)' : 'var(--border)'}`,
                                background: method === o.v ? 'rgba(201,168,76,0.1)' : 'var(--card-bg)', color: method === o.v ? 'var(--gold-dark)' : 'var(--text-secondary)',
                            }}>{o.t}</button>
                        ))}
                        <button type="button" disabled title="Coming soon" style={{
                            flex: '1 1 40%', padding: '0.6rem', borderRadius: 'var(--radius-sm)', cursor: 'not-allowed', fontFamily: 'Outfit, sans-serif', fontWeight: '600', fontSize: '0.82rem',
                            border: '1.5px dashed var(--border)', background: 'var(--warm-gray)', color: 'var(--text-muted)',
                        }}>
                            Card (DPO)
                            <span style={{ display: 'block', fontSize: '0.62rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Coming soon</span>
                        </button>
                    </div>

                    <div style={{ background: 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {method === 'cash'
                            ? <>Pay {wallet.provider?.name} in cash, then submit this request. They’ll confirm receipt and your balance will update.</>
                            : instructions
                                ? <><strong style={{ color: 'var(--charcoal)' }}>How to pay {wallet.provider?.name}:</strong><br />{instructions.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}</>
                                : <>Pay {wallet.provider?.name} directly (bank transfer, eWallet, PayToday or cash deposit), then submit this request with your reference. They’ll approve it once the money arrives.</>}
                    </div>

                    <label style={labelStyle}>Amount (N$)</label>
                    <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" className="input" style={{ width: '100%', marginBottom: '1rem' }} required />

                    <label style={labelStyle}>Payment reference</label>
                    <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} className="input" style={{ width: '100%', marginBottom: '1rem' }} />

                    <label style={labelStyle}>Proof of payment (optional — image or PDF)</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1rem', border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: proofUrl ? 'var(--gold-dark)' : 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                        {proofUrl ? <Check size={16} /> : <Upload size={16} />}
                        {uploading ? 'Uploading…' : proofUrl ? (isPdf ? 'PDF uploaded — tap to replace' : 'Proof uploaded — tap to replace') : 'Upload a screenshot, receipt or PDF'}
                        <input type="file" accept="image/*,application/pdf" onChange={handleProof} style={{ display: 'none' }} />
                    </label>

                    {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>}

                    <button type="submit" disabled={busy || uploading} className="btn-primary" style={{ width: '100%', padding: '0.85rem' }}>
                        {busy ? 'Submitting…' : 'Submit top-up request'}
                    </button>
                    <p style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.7rem 0 0' }}>
                        Your balance updates once {wallet.provider?.name} confirms the payment.
                    </p>
                </form>
            </div>
        </div>
    );
};

export default Wallet;
