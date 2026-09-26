import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { walletService, giftCardService } from '../services';
import { cloudinaryAvatar } from '../utils/cloudinary';
import { currencySymbol } from '../utils/currency';
import { Wallet as WalletIcon, Clock, Check, ChevronDown, ChevronUp, Gift } from 'lucide-react';
import WalletTopUpModal from '../components/WalletTopUpModal';
import WalletRules, { formatExpiryDate } from '../components/WalletRules';
import { useToast } from '../components/Toast';
import { FEATURES, WALLET_COMING_SOON_LINE } from '@bookplus/config/features.mjs';

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
        case 'giftcard':
            return { label: `Gift card redeemed${t.reference ? ` · ${t.reference}` : ''}`, amount: `+${money(t.amount, cur)}`, color: credit };
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
    const [loadError, setLoadError] = useState('');
    // Redeem a gift card. A gift card email links here with ?redeem=<code>.
    const [searchParams] = useSearchParams();
    const [giftCode, setGiftCode] = useState(() => searchParams.get('redeem') || '');
    const [giftBusy, setGiftBusy] = useState(false);
    const [giftResult, setGiftResult] = useState(null); // { ok, text, providerId? }

    const load = useCallback(async () => {
        try {
            const [w, a] = await Promise.all([
                walletService.getMyWallets(),
                walletService.getMyPendingAdjustments(),
            ]);
            setWallets(w.data.data || []);
            setPendingAdjustments(a.data.data || []);
            setLoadError('');
        } catch (err) {
            // Swallowing this showed "No wallets yet" to someone who may hold a real
            // prepaid balance — telling a customer their money isn't there when the
            // request simply failed.
            setLoadError(err.response?.data?.message || 'Could not load your wallets. Check your connection and try again.');
        } finally { setLoading(false); }
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

    const redeemGift = async (e) => {
        e.preventDefault();
        if (!giftCode.trim()) return;
        setGiftBusy(true); setGiftResult(null);
        try {
            const res = await giftCardService.redeem(giftCode.trim());
            const d = res.data.data;
            setGiftResult({ ok: true, text: `${money(d.amount, d.provider?.currency)} added to your wallet with ${d.provider?.name}.`, providerId: d.provider?._id, providerName: d.provider?.name });
            setGiftCode('');
            setTxns({}); setExpanded(null);
            await load();
        } catch (err) {
            setGiftResult({ ok: false, text: err.response?.data?.message || 'Could not redeem the gift card. Please try again.' });
        } finally { setGiftBusy(false); }
    };

    const resolveAdjustment = async (id, approve) => {
        setBusyId(id);
        try {
            approve ? await walletService.approveAdjustment(id) : await walletService.rejectAdjustment(id);
            await load();
            setTxns({}); setExpanded(null);
            toast(approve ? 'Adjustment approved.' : 'Adjustment declined.', 'success');
        } catch (err) {
            toast(err.response?.data?.message || 'Could not update the adjustment', 'error');
        } finally { setBusyId(''); }
    };

    // Wallet "coming soon" (FEATURES.walletEnabled off): no top-ups, gift cards
    // or wallet payments. A balance that already exists is never hidden: it is
    // listed read-only so the client knows to settle it with the business.
    if (!FEATURES.walletEnabled) {
        const held = wallets.filter((w) => (w.totalBalance || 0) > 0);
        return (
            <div style={{ maxWidth: '860px', margin: '0 auto', padding: 'calc(56px + 1.5rem) 1rem 4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                    <WalletIcon size={26} color="var(--gold)" />
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>My Wallet</h1>
                </div>
                <div data-testid="wallet-coming-soon" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.5rem 1.25rem', textAlign: 'center', marginBottom: '1.5rem' }}>
                    <WalletIcon size={36} color="var(--text-muted)" style={{ marginBottom: '0.6rem' }} />
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '600', color: 'var(--charcoal)', margin: '0 0 0.35rem' }}>
                        Wallet — coming soon
                    </h2>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{WALLET_COMING_SOON_LINE}</p>
                </div>
                {loadError && wallets.length === 0 && (
                    <p role="alert" style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: '0 0 1rem' }}>
                        {loadError} <button onClick={load} className="btn-outline" style={{ padding: '0.3rem 0.8rem', fontSize: '0.82rem', marginLeft: '0.4rem' }}>Try again</button>
                    </p>
                )}
                {held.length > 0 && (
                    <div data-testid="wallet-readonly-balances" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {held.map((w) => (
                            <div key={w._id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.9rem 1.1rem', fontSize: '0.92rem', color: 'var(--charcoal)' }}>
                                Your balance with <strong>{w.provider?.name || 'this business'}</strong>: <strong>{money(w.totalBalance, w.provider?.businessProfile?.currency)}</strong> — contact the business.
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '860px', margin: '0 auto', padding: 'calc(56px + 1.5rem) 1rem 4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                <WalletIcon size={26} color="var(--gold)" />
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>My Wallet</h1>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '0 0 1.75rem' }}>
                Prepaid balances you hold with your businesses. Top up by paying the business directly — they approve it and your balance updates.
            </p>

            {/* Redeem a gift card */}
            <form onSubmit={redeemGift} data-testid="redeem-gift" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem 1.15rem', marginBottom: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                <label htmlFor="gift-code" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--charcoal)' }}>
                    <Gift size={20} color="var(--gold-dark)" aria-hidden="true" />Redeem a gift card
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input id="gift-code" className="input" value={giftCode} onChange={(e) => setGiftCode(e.target.value.toUpperCase())} placeholder="GIFT-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck="false"
                        style={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', letterSpacing: '0.06em' }} />
                    <button type="submit" className="btn-primary" disabled={giftBusy || !giftCode.trim()} style={{ minHeight: '48px', padding: '0 1.1rem', flexShrink: 0 }}>
                        {giftBusy ? 'Redeeming…' : 'Redeem'}
                    </button>
                </div>
                {giftResult && (
                    <div role="status" style={{ padding: '0.65rem 0.8rem', borderRadius: '10px', fontSize: '0.88rem', fontWeight: 600, background: giftResult.ok ? '#dff1e7' : 'var(--danger-bg)', color: giftResult.ok ? '#1a5e3b' : 'var(--danger-fg)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <span>{giftResult.text}</span>
                        {giftResult.ok && giftResult.providerId && (
                            <Link to={`/providers/${giftResult.providerId}`} style={{ color: 'inherit', textDecoration: 'underline' }}>Book with {giftResult.providerName}</Link>
                        )}
                    </div>
                )}
            </form>

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
            ) : wallets.length === 0 && loadError ? (
                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '2.5rem 1.5rem', textAlign: 'center' }}>
                    <WalletIcon size={40} color="var(--text-muted)" style={{ marginBottom: '0.75rem' }} />
                    <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)', margin: '0 0 0.4rem' }}>Couldn’t load your wallets</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 0.4rem' }}>{loadError}</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1.25rem' }}>Any balance you hold is safe — this is only a display problem.</p>
                    <button onClick={load} className="btn-primary" style={{ padding: '0.6rem 1.4rem' }}>Try again</button>
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

                                    {/* When this balance expires (if the business set an expiry) and the
                                        business's refund rule — the same rules shown before topping up. */}
                                    {w.rules?.expiresAt && (
                                        <p data-testid="wallet-expiry" style={{ margin: '0 0 0.75rem', padding: '0.55rem 0.75rem', borderRadius: 'var(--radius-sm)', background: 'var(--warning-bg)', color: 'var(--warning-fg)', fontSize: '0.82rem', fontWeight: '600' }}>
                                            Balance expires on {formatExpiryDate(w.rules.expiresAt)} unless you use or top up this wallet before then.
                                        </p>
                                    )}
                                    {w.rules && (
                                        <details style={{ margin: '0 0 1rem' }}>
                                            <summary style={{ cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-secondary)' }}>
                                                Wallet rules: {w.rules.refundsAllowed ? 'refundable' : 'non-refundable'} · {w.rules.expiryMonths ? `expires after ${w.rules.expiryMonths} months without activity` : 'no expiry'}
                                            </summary>
                                            <div style={{ marginTop: '0.5rem' }}>
                                                <WalletRules rules={w.rules} providerName={w.provider?.name || 'This business'} compact />
                                            </div>
                                        </details>
                                    )}

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
