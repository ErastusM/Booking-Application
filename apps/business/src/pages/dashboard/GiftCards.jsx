import React, { useCallback, useEffect, useState } from 'react';
import { FEATURES } from '@bookplus/config/features.mjs';
import ComingSoon from '../../components/ComingSoon';
import { Gift, Plus, Copy, Check, Share2, ChevronLeft } from 'lucide-react';
import { giftCardService, walletService } from '../../services';
import { useToast } from '../../components/Toast';
import { currencySymbol } from '../../utils/currency';
// App-styled confirm dialog in place of window.confirm.
import { useConfirm } from '@bookplus/ui';

// Gift cards (owner). Three views on one screen: the list, "sell a gift card",
// and the finished card to hand over. The owner is paid directly (cash, EFT,
// PayToday) — Bookplus only records the sale and turns the code into wallet
// credit with this business when someone redeems it.

const STATUS = {
    active:   { label: 'Not used',  bg: 'var(--info-bg)',       fg: 'var(--info-fg)' },
    redeemed: { label: 'Redeemed',  bg: '#dff1e7',              fg: '#1a5e3b' },
    void:     { label: 'Cancelled', bg: 'var(--surface-sunken)', fg: 'var(--text-secondary)' },
};
const PRESETS = [150, 300, 500];

const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' };
const label = { fontSize: '0.88rem', fontWeight: 600, color: 'var(--charcoal)' };
const mono = { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', letterSpacing: '0.06em' };

const GiftCards = ({ currency = 'NAD', businessName = '' }) => {
    const toast = useToast();
    const confirm = useConfirm();
    const sym = currencySymbol(currency);
    const money = (n) => `${sym}${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

    const [data, setData] = useState(null);      // { cards, totals, walletEnabled }
    const [error, setError] = useState('');
    const [view, setView] = useState('list');    // 'list' | 'sell' | 'card'
    const [current, setCurrent] = useState(null); // the card being shown in 'card' view
    const [busy, setBusy] = useState('');
    const [copied, setCopied] = useState(false);
    const [form, setForm] = useState({ preset: 300, other: '', recipientName: '', recipientEmail: '', fromName: '', message: '', paid: false });

    const load = useCallback(async () => {
        try {
            const res = await giftCardService.list();
            setData(res.data.data); setError('');
        } catch (err) { setError(err.response?.data?.message || 'Could not load your gift cards.'); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const amount = form.preset === 'other' ? Number(form.other) : form.preset;
    const canCreate = amount >= 1 && form.recipientName.trim() && form.paid && busy !== 'create';

    const turnOnWallet = async () => {
        setBusy('wallet');
        try {
            await walletService.updateSettings({ enabled: true, bookingPaymentMode: 'wallet_optional' });
            toast('Client wallet is on. Clients can still pay cash.', 'success');
            await load();
        } catch (err) { toast(err.response?.data?.message || 'Could not turn on the wallet', 'error'); } finally { setBusy(''); }
    };

    const create = async () => {
        setBusy('create');
        try {
            const res = await giftCardService.create({
                amount, recipientName: form.recipientName, recipientEmail: form.recipientEmail,
                fromName: form.fromName, message: form.message, paid: true,
            });
            setCurrent(res.data.data);
            setView('card');
            setForm({ preset: 300, other: '', recipientName: '', recipientEmail: '', fromName: '', message: '', paid: false });
            load();
        } catch (err) { toast(err.response?.data?.message || 'Could not create the gift card', 'error'); } finally { setBusy(''); }
    };

    const cancelCard = async (c) => {
        if (!(await confirm({
            title: `Cancel the ${money(c.amount)} gift card for ${c.recipientName}?`,
            message: 'The code will stop working.',
            confirmLabel: 'Cancel gift card',
            cancelLabel: 'Keep it',
            danger: true,
        }))) return;
        setBusy('void');
        try {
            const res = await giftCardService.void(c._id);
            setCurrent(res.data.data);
            toast('Gift card cancelled.', 'success');
            load();
        } catch (err) { toast(err.response?.data?.message || 'Could not cancel the gift card', 'error'); } finally { setBusy(''); }
    };

    const copyCode = async (code) => {
        try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* blocked */ }
    };
    const shareCard = async (c) => {
        const text = `${c.fromName ? `${c.fromName} sent you` : 'You have'} a ${money(c.amount)} gift card for ${businessName}. Your code: ${c.code}. Redeem it in your Bookplus wallet.`;
        if (navigator.share) { try { await navigator.share({ title: `Gift card for ${businessName}`, text }); } catch { /* cancelled */ } }
        else copyCode(c.code);
    };

    const backBtn = (
        <button type="button" onClick={() => { setView('list'); setCurrent(null); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', minHeight: '44px', padding: 0, border: 'none', background: 'none', color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}>
            <ChevronLeft size={18} aria-hidden="true" />Gift cards
        </button>
    );

    if (error && !data) {
        return (
            <div style={{ ...card, padding: '2rem 1.5rem', textAlign: 'center' }}>
                <p style={{ margin: '0 0 0.75rem', color: 'var(--charcoal)', fontWeight: 600 }}>{error}</p>
                <button type="button" onClick={load} className="btn-primary" style={{ padding: '0.5rem 1.2rem' }}>Try again</button>
            </div>
        );
    }
    if (!data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;

    /* ── The finished card ───────────────────────────── */
    if (view === 'card' && current) {
        const st = STATUS[current.status] || STATUS.active;
        return (
            <div style={{ maxWidth: '460px', display: 'flex', flexDirection: 'column', gap: '1rem' }} data-testid="giftcard-created">
                {backBtn}
                <div style={{ borderRadius: '18px', padding: '1.25rem', background: 'var(--ink)', color: '#fff', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem' }}>{businessName}</span>
                        <Gift size={20} color="var(--gold)" aria-hidden="true" />
                    </div>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2.4rem', lineHeight: 1 }}>{money(current.amount)}</span>
                    <span style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.75)' }}>For {current.recipientName}{current.fromName ? ` · from ${current.fromName}` : ''}</span>
                    <span data-testid="giftcard-code" style={{ ...mono, fontSize: '1.25rem', padding: '0.6rem', border: '1px dashed rgba(255,255,255,0.4)', borderRadius: '10px', textAlign: 'center' }}>{current.code}</span>
                </div>
                {current.status !== 'active' ? (
                    <p style={{ margin: 0, fontWeight: 600, color: st.fg }}>{st.label}</p>
                ) : current.emailed ? (
                    <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1a5e3b', fontWeight: 600, fontSize: '0.9rem' }}><Check size={18} aria-hidden="true" />Emailed to {current.recipientEmail}</p>
                ) : (
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Hand over or share the code. It works in any client’s Bookplus wallet.</p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.6rem' }}>
                    <button type="button" onClick={() => copyCode(current.code)} className="btn-outline" style={{ minHeight: '48px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? 'Copied' : 'Copy code'}
                    </button>
                    <button type="button" onClick={() => shareCard(current)} className="btn-outline" style={{ minHeight: '48px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                        <Share2 size={16} aria-hidden="true" />Share
                    </button>
                </div>
                {current.status === 'active' && (
                    <>
                        <button type="button" onClick={() => cancelCard(current)} disabled={busy === 'void'} data-testid="giftcard-void" className="btn-outline" style={{ minHeight: '48px', borderColor: 'var(--danger)', color: 'var(--danger-fg)' }}>
                            Cancel this gift card
                        </button>
                        <p style={{ margin: 0, textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>You can cancel it until it’s redeemed.</p>
                    </>
                )}
            </div>
        );
    }

    /* ── Sell a gift card ─────────────────────────────── */
    if (view === 'sell') {
        const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
        const pill = (on) => ({ minHeight: '44px', borderRadius: '10px', border: on ? '2px solid var(--charcoal)' : '1px solid var(--border)', background: 'var(--card-bg)', fontWeight: 600, fontFamily: 'var(--font-body)', color: 'var(--charcoal)', cursor: 'pointer' });
        return (
            <div style={{ maxWidth: '460px', display: 'flex', flexDirection: 'column', gap: '1rem' }} data-testid="giftcard-sell">
                {backBtn}
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 800 }}>Sell a gift card</h2>
                <div style={{ ...card, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                    <fieldset style={{ margin: 0, padding: 0, border: 0 }}>
                        <legend style={{ ...label, paddingBottom: '0.45rem' }}>Amount</legend>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.5rem' }}>
                            {PRESETS.map((p) => (
                                <button key={p} type="button" aria-pressed={form.preset === p} onClick={() => setForm((f) => ({ ...f, preset: p }))} style={pill(form.preset === p)}>{sym}{p}</button>
                            ))}
                            <button type="button" aria-pressed={form.preset === 'other'} onClick={() => setForm((f) => ({ ...f, preset: 'other' }))} style={pill(form.preset === 'other')}>Other</button>
                        </div>
                        {form.preset === 'other' && (
                            <input className="input" type="number" min="1" inputMode="decimal" aria-label="Amount" placeholder={`Amount in ${sym}`} value={form.other} onChange={set('other')} style={{ marginTop: '0.5rem' }} data-testid="giftcard-other" />
                        )}
                    </fieldset>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <span style={label}>Who is it for? <span style={{ color: 'var(--gold-dark)' }}>*</span></span>
                        <input className="input" value={form.recipientName} onChange={set('recipientName')} data-testid="giftcard-recipient" />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <span style={label}>Their email</span>
                        <input className="input" type="email" value={form.recipientEmail} onChange={set('recipientEmail')} data-testid="giftcard-email" />
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>We email them the code. Leave empty to hand it over yourself.</span>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <span style={label}>From</span>
                        <input className="input" value={form.fromName} onChange={set('fromName')} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <span style={label}>Message</span>
                        <textarea className="input" rows={2} maxLength={300} value={form.message} onChange={set('message')} style={{ resize: 'vertical' }} />
                    </label>
                </div>
                <label style={{ ...card, padding: '0.9rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.paid} onChange={(e) => setForm((f) => ({ ...f, paid: e.target.checked }))} data-testid="giftcard-paid" style={{ width: '20px', height: '20px', marginTop: '2px', accentColor: 'var(--charcoal)' }} />
                    <span style={{ fontSize: '0.9rem', lineHeight: 1.45 }}>
                        <strong>I’ve been paid {amount >= 1 ? money(amount) : ''}</strong><br />
                        <span style={{ color: 'var(--text-muted)' }}>Cash, EFT or PayToday. The card is live as soon as you save.</span>
                    </span>
                </label>
                <button type="button" onClick={create} disabled={!canCreate} className="btn-primary" data-testid="giftcard-create" style={{ minHeight: '52px', fontSize: '1rem' }}>
                    {busy === 'create' ? 'Creating…' : 'Create gift card'}
                </button>
            </div>
        );
    }

    /* ── The list ─────────────────────────────────────── */
    return (
        <div style={{ maxWidth: '640px', display: 'flex', flexDirection: 'column', gap: '1rem' }} data-testid="giftcards">
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '0.75rem' }}>
                <div>
                    <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 800 }}>Gift cards</h2>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>{money(data.totals.sold)} sold · {money(data.totals.unused)} not yet used</p>
                </div>
                {FEATURES.walletEnabled && data.walletEnabled && (
                    <button type="button" onClick={() => setView('sell')} className="btn-primary" data-testid="giftcard-new" style={{ minHeight: '44px', padding: '0 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Plus size={17} aria-hidden="true" />Sell
                    </button>
                )}
            </div>

            {!FEATURES.walletEnabled ? (
                // Gift cards become wallet credit, so they wait for the wallet.
                <ComingSoon testId="giftcards-coming-soon" title="Gift cards — coming soon" line="Gift cards arrive with the client wallet. Clients pay you at their appointment for now." />
            ) : !data.walletEnabled ? (
                <div style={{ ...card, padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <p style={{ margin: 0, fontWeight: 700, color: 'var(--charcoal)' }}>Turn on your client wallet first</p>
                    <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>A redeemed gift card becomes wallet credit with your business. Clients can still choose to pay cash for any booking.</p>
                    <button type="button" onClick={turnOnWallet} disabled={busy === 'wallet'} className="btn-primary" style={{ alignSelf: 'flex-start', minHeight: '44px', padding: '0 1.1rem' }}>
                        {busy === 'wallet' ? 'Turning on…' : 'Turn on client wallet'}
                    </button>
                </div>
            ) : (
                <p style={{ margin: 0, padding: '0.65rem 0.8rem', borderRadius: '10px', background: 'var(--surface-sunken)', fontSize: '0.84rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                    Gift cards become wallet credit with your business when the person redeems the code. You take the payment the way you do now: cash, EFT or PayToday.
                </p>
            )}

            {data.cards.length > 0 ? (
                <ul style={{ ...card, margin: 0, padding: 0, listStyle: 'none', overflow: 'hidden' }}>
                    {data.cards.map((c, i) => {
                        const st = STATUS[c.status] || STATUS.active;
                        return (
                            <li key={c._id} style={{ borderTop: i ? '1px solid var(--border)' : 'none' }}>
                                <button type="button" onClick={() => { setCurrent(c); setView('card'); }} data-testid="giftcard-row" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.8rem 1rem', minHeight: '56px', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                                    <span style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ display: 'block', fontWeight: 600, color: 'var(--charcoal)' }}>{money(c.amount)} · for {c.recipientName}</span>
                                        <span style={{ display: 'block', ...mono, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{c.code}</span>
                                    </span>
                                    <span style={{ padding: '0.15rem 0.6rem', borderRadius: '999px', background: st.bg, color: st.fg, fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{st.label}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : FEATURES.walletEnabled && data.walletEnabled && (
                <div style={{ ...card, padding: '2rem 1.25rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Gift size={28} color="var(--gold)" aria-hidden="true" style={{ marginBottom: '0.5rem' }} />
                    <p style={{ margin: 0 }}>No gift cards yet. Tap Sell when someone buys one.</p>
                </div>
            )}
        </div>
    );
};

export default GiftCards;
