import React, { useEffect, useRef, useState } from 'react';
import { businessName, walletLine, adjustButtonLabel, nMoney } from '../utils/adminPanel';

// Admin → Wallet → "Credit or debit a business". Any business on Bookplus can
// be picked — not only the ones that already sent a top-up (those were the only
// ones with a wallet row, so nobody else could ever be credited). A business
// with no wallet shows "No wallet yet"; the first credit opens it.
//
//   searchProviders(text) → Promise<provider users>
//   walletFor(providerId) → its wallet row, or undefined
//   submit({ provider, direction, amount, reason }) → Promise (throws with the API error)
//   initial: a provider to start with (the Credit / Debit button on a balance row)
const WalletAdjustDialog = ({ searchProviders, walletFor, submit, onClose, initial = null }) => {
    const [picked, setPicked] = useState(initial);
    const [q, setQ] = useState('');
    const [rows, setRows] = useState([]);
    const [searching, setSearching] = useState(!initial);
    const [direction, setDirection] = useState('credit');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const searchRef = useRef(searchProviders);
    searchRef.current = searchProviders;

    useEffect(() => {
        if (picked) return undefined;
        let alive = true;
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const list = await searchRef.current(q.trim());
                if (alive) { setRows(list); setError(''); }
            } catch {
                if (alive) setError('Could not load businesses.');
            } finally {
                if (alive) setSearching(false);
            }
        }, 250);
        return () => { alive = false; clearTimeout(t); };
    }, [q, picked]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, busy]);

    const wallet = picked ? walletFor(picked._id) : null;
    const name = picked ? businessName(picked) : '';

    const onSubmit = async (e) => {
        e.preventDefault();
        const amt = parseFloat(amount);
        if (!(amt > 0)) { setError('Enter a valid amount'); return; }
        setBusy(true); setError('');
        try {
            await submit({ provider: picked, direction, amount: amt, reason });
        } catch (err) {
            setError(err.response?.data?.message || 'Could not adjust the balance');
            setBusy(false);
        }
    };

    const toggle = (on) => ({
        flex: 1, padding: '0.55rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: '600', fontSize: '0.82rem',
        border: `1.5px solid ${on ? 'var(--gold)' : 'var(--border)'}`,
        background: on ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)', color: on ? 'var(--gold-dark)' : 'var(--text-secondary)',
    });

    return (
        <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
            <div role="dialog" aria-modal="true" aria-labelledby="wallet-adjust-title" data-testid="wallet-adjust-dialog" onClick={(e) => e.stopPropagation()}
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '440px', overflow: 'hidden' }}>
                <div style={{ padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                    <h2 id="wallet-adjust-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Credit or debit a business</h2>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>Applies immediately and is recorded on the business’s account.</p>
                </div>

                <style>{'.admin-pick-row:hover, .admin-pick-row:focus-visible { background: var(--warm-gray) !important; }'}</style>
                {!picked ? (
                    <div>
                        <div style={{ padding: '1rem 1.25rem 0.5rem' }}>
                            <input autoFocus aria-label="Search businesses" value={q} onChange={(e) => setQ(e.target.value)}
                                placeholder="Search by business, owner or email…" className="input" style={{ width: '100%' }} />
                        </div>
                        <div style={{ maxHeight: '320px', overflowY: 'auto', padding: '0.25rem 0.5rem 0.75rem' }}>
                            {error ? (
                                <p style={{ padding: '1rem', color: 'var(--danger-fg)', fontSize: '0.85rem', margin: 0 }}>{error}</p>
                            ) : searching && rows.length === 0 ? (
                                <p style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Searching…</p>
                            ) : rows.length === 0 ? (
                                <p style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>No businesses match.</p>
                            ) : rows.map((p) => {
                                const w = walletFor(p._id);
                                return (
                                    <button key={p._id} type="button" onClick={() => { setPicked(p); setError(''); }} className="admin-pick-row" style={{
                                        display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', textAlign: 'left',
                                        background: 'none', border: 'none', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.75rem', cursor: 'pointer', fontFamily: 'var(--font-body)',
                                    }}>
                                        <span style={{ minWidth: 0 }}>
                                            <span style={{ display: 'block', fontWeight: 600, color: 'var(--charcoal)', fontSize: '0.88rem' }}>{businessName(p)}</span>
                                            <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name} · {p.email}</span>
                                        </span>
                                        <span style={{ flexShrink: 0, fontSize: '0.74rem', fontWeight: 600, color: w ? 'var(--gold-dark)' : 'var(--text-muted)' }}>{walletLine(w)}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={onClose} className="btn-outline" style={{ padding: '0.5rem 1.1rem' }}>Cancel</button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={onSubmit} style={{ padding: '1.1rem 1.25rem 1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 0.85rem', background: 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                            <span style={{ minWidth: 0 }}>
                                <span style={{ display: 'block', fontWeight: 600, color: 'var(--charcoal)', fontSize: '0.9rem' }}>{name}</span>
                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{walletLine(wallet)}</span>
                            </span>
                            {!initial && (
                                <button type="button" onClick={() => setPicked(null)} disabled={busy} style={{ background: 'none', border: 'none', color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'var(--font-body)', flexShrink: 0 }}>Change</button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }} role="group" aria-label="Credit or debit">
                            <button type="button" aria-pressed={direction === 'credit'} onClick={() => setDirection('credit')} style={toggle(direction === 'credit')}>Credit (add)</button>
                            <button type="button" aria-pressed={direction === 'debit'} onClick={() => setDirection('debit')} style={toggle(direction === 'debit')}>Debit (remove)</button>
                        </div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }} htmlFor="wallet-amount">Amount (N$)</label>
                        <input id="wallet-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="input" style={{ width: '100%', marginBottom: '0.75rem' }} required />
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }} htmlFor="wallet-reason">Reason</label>
                        <input id="wallet-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. manual deposit, correction" className="input" style={{ width: '100%', marginBottom: '1rem' }} maxLength={200} />
                        {direction === 'debit' && !wallet && (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>This business has no wallet yet, so there is nothing to debit.</p>
                        )}
                        {error && <p role="alert" style={{ color: 'var(--danger-fg)', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{error}</p>}
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button type="submit" disabled={busy} className="btn-primary" style={{ flex: 1, padding: '0.75rem' }}>
                                {busy ? 'Saving…' : adjustButtonLabel(direction, amount, name)}
                            </button>
                            <button type="button" onClick={onClose} disabled={busy} className="btn-outline" style={{ padding: '0.75rem 1.1rem' }}>Cancel</button>
                        </div>
                        {wallet && direction === 'debit' && Number(amount) > wallet.balance && (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0.6rem 0 0' }}>More than the balance of {nMoney(wallet.balance)} — this will be refused.</p>
                        )}
                    </form>
                )}
            </div>
        </div>
    );
};

export default WalletAdjustDialog;
