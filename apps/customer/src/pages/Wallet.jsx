import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { walletService } from '../services';
import { cloudinaryAvatar } from '../utils/cloudinary';
import { currencySymbol } from '../utils/currency';
import { Wallet as WalletIcon, Clock, Check, ChevronDown, ChevronUp } from 'lucide-react';
import WalletTopUpModal from '../components/WalletTopUpModal';
import { useToast } from '../components/Toast';

// Wallet.currency (the API's own field) is never set away from its schema default —
// the provider's real pricing currency lives on their businessProfile, which
// getMyWallets populates. Prefer that; fall back to N$ if it's ever missing.
const money = (n, cur) => `${currencySymbol(cur)}${Number(n || 0).toFixed(2)}`;

// Human label + colour for a transaction row.
const describe = (t, cur) => {
    const credit = 'var(--success)', debit = 'var(--danger)', hold = 'var(--warning)', muted = 'var(--text-muted)';
    switch (t.type) {
        case 'topup':
            if (t.status === 'pending') return { label: 'Top-up — awaiting approval', amount: `+${money(t.amount, cur)}`, color: muted };
            if (t.status === 'approved') return { label: 'Top-up approved', amount: `+${money(t.amount, cur)}`, color: credit };
            return { label: 'Top-up rejected', amount: money(t.amount, cur), color: muted };
        case 'reservation':
            if (t.status === 'reserved') return { label: 'Reserved for booking', amount: `${money(t.amount, cur)} held`, color: hold };
            if (t.status === 'released') return { label: 'Reservation released', amount: `${money(t.amount, cur)} freed`, color: credit };
            return { label: 'Reservation used', amount: money(t.amount, cur), color: muted };
        case 'deduction':
            return { label: 'Service deduction', amount: `−${money(t.amount, cur)}`, color: debit };
        case 'refund':
            if (t.status === 'pending') return { label: 'Refund — awaiting your approval', amount: `+${money(t.amount, cur)}`, color: muted };
            if (t.status === 'approved') return { label: 'Refund applied', amount: `+${money(t.amount, cur)}`, color: credit };
            return { label: 'Refund declined', amount: money(t.amount, cur), color: muted };
        case 'adjustment': {
            const isCredit = t.direction === 'credit';
            const verb = t.status === 'pending' ? '— awaiting your approval' : t.status === 'approved' ? 'applied' : 'declined';
            return {
                label: `${isCredit ? 'Credit' : 'Debit'} adjustment ${verb}`,
                amount: `${isCredit ? '+' : '−'}${money(t.amount, cur)}`,
                color: t.status !== 'approved' ? muted : (isCredit ? credit : debit),
            };
        }
        default: return { label: t.type, amount: money(t.amount, cur), color: muted };
    }
};

const Wallet = () => {
    const toast = useToast();
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

    // getMyPendingAdjustments doesn't populate the provider's businessProfile (only
    // `name`), so borrow the currency from the matching wallet already loaded here —
    // a pending adjustment always implies an existing wallet with that provider.
    const currencyByProvider = useMemo(() => {
        const map = {};
        wallets.forEach((w) => {
            const pid = String(w.provider?._id || w.provider || '');
            if (pid) map[pid] = w.provider?.businessProfile?.currency;
        });
        return map;
    }, [wallets]);

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
            toast(err.response?.data?.message || 'Could not update the adjustment', 'error');
        } finally { setBusyId(''); }
    };

    return (
        <div style={{ maxWidth: '860px', margin: '0 auto', padding: 'calc(56px + 1.5rem) 1rem 4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                <WalletIcon size={26} color="var(--gold)" />
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>My Wallet</h1>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '0 0 1.75rem' }}>
                Prepaid balances you hold with your businesses. Top up by paying the business directly — they approve it and your balance updates.
            </p>

            {/* Adjustments awaiting the client's approval */}
            {pendingAdjustments.length > 0 && (
                <div style={{ marginBottom: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {pendingAdjustments.map((a) => {
                        const isCredit = a.direction === 'credit';
                        const cur = currencyByProvider[String(a.provider?._id || a.provider || '')];
                        return (
                            <div key={a._id} style={{ background: 'rgba(240,62,22,0.08)', border: '1px solid var(--gold)', borderRadius: 'var(--radius)', padding: '1rem 1.25rem' }}>
                                <p style={{ margin: '0 0 0.35rem', fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.95rem' }}>
                                    {a.provider?.name} proposes a {isCredit ? 'credit of' : 'debit of'} <strong>{money(a.amount, cur)}</strong>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {[0, 1].map((i) => (
                        <div key={i} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0 }} />
                                <div style={{ flex: 1 }}>
                                    <div className="skeleton skeleton-title" style={{ width: '45%' }} />
                                    <div className="skeleton skeleton-line" style={{ width: '30%', marginBottom: 0 }} />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
                                {[0, 1, 2].map((j) => (
                                    <div key={j} className="skeleton" style={{ height: '58px', borderRadius: 'var(--radius-sm)' }} />
                                ))}
                            </div>
                            <div className="skeleton" style={{ height: '36px', width: '55%', borderRadius: 'var(--radius-sm)' }} />
                        </div>
                    ))}
                </div>
            ) : wallets.length === 0 ? (
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2.5rem 1.5rem', textAlign: 'center' }}>
                    <WalletIcon size={40} color="var(--text-muted)" style={{ marginBottom: '0.75rem' }} />
                    <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)', margin: '0 0 0.4rem' }}>No wallets yet</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 1.25rem' }}>
                        A wallet is created the first time you top up with a business or book a service that requires prepayment.
                    </p>
                    <Link to="/" className="btn-primary" style={{ textDecoration: 'none', padding: '0.6rem 1.4rem' }}>Browse businesses</Link>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {wallets.map((w) => {
                        const pid = w.provider?._id || w.provider;
                        const open = expanded === pid;
                        const cur = w.provider?.businessProfile?.currency;
                        return (
                            <div key={w._id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                <div style={{ padding: '1.25rem 1.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                                        {w.provider?.avatar
                                            ? <img src={cloudinaryAvatar(w.provider.avatar, 96)} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                                            : <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--warm-gray)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '600', color: 'var(--gold-dark)' }}>{(w.provider?.name || '?')[0]}</div>}
                                        <div>
                                            <p style={{ margin: 0, fontWeight: '600', color: 'var(--charcoal)' }}>{w.provider?.name || 'Business'}</p>
                                            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>{w.provider?.providerCategory || w.provider?.businessProfile?.businessName || ''}</p>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
                                        {[
                                            { label: 'Available', val: w.availableBalance, accent: true },
                                            { label: 'Reserved', val: w.reservedBalance },
                                            { label: 'Total', val: w.totalBalance },
                                        ].map((b) => (
                                            <div key={b.label} style={{ background: b.accent ? 'rgba(240,62,22,0.1)' : 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', padding: '0.7rem 0.5rem', textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{b.label}</div>
                                                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '600', color: b.accent ? 'var(--gold-dark)' : 'var(--charcoal)' }}>{money(b.val, cur)}</div>
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
                                            <div>
                                                {[0, 1, 2].map((i) => (
                                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 1.5rem', borderBottom: '1px solid var(--border)', gap: '1rem' }}>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div className="skeleton skeleton-line" style={{ width: '55%' }} />
                                                            <div className="skeleton skeleton-line" style={{ width: '35%', height: '10px', marginBottom: 0 }} />
                                                        </div>
                                                        <div className="skeleton skeleton-line" style={{ width: '56px', marginBottom: 0, flexShrink: 0 }} />
                                                    </div>
                                                ))}
                                            </div>
                                        ) : txns[pid].length === 0 ? (
                                            <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No transactions yet.</div>
                                        ) : (
                                            <div>
                                                {txns[pid].map((t) => {
                                                    const d = describe(t, cur);
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
                                                                <div style={{ fontWeight: '600', fontSize: '0.85rem', color: d.color }}>{d.amount}</div>
                                                                {t.balanceAfter?.total != null && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>bal {money(t.balanceAfter.total, cur)}</div>}
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
                <WalletTopUpModal
                    providerId={topUpFor.provider?._id || topUpFor.provider}
                    providerName={topUpFor.provider?.name || 'Business'}
                    currency={topUpFor.provider?.businessProfile?.currency}
                    onClose={() => setTopUpFor(null)}
                    onDone={() => { setTopUpFor(null); setTxns({}); setExpanded(null); load(); }}
                />
            )}
        </div>
    );
};

export default Wallet;
