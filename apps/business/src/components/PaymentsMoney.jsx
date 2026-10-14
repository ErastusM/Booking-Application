import React, { useCallback, useEffect, useState } from 'react';
import { onlinePaymentsService } from '../services';
import { useToast } from './Toast';
import RefundDialog from './RefundDialog';
import { nad, paymentStatusText, stuckRefund, payoutScheduleText } from '../utils/onlinePayment';

// Account → Online payments, once approved: what Bookplus owes the business,
// its bookings paid online (each with what Bookplus kept, and a Refund), and
// its statement with a running balance and a CSV download.

const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem', minWidth: 0 };
const h3 = { fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--charcoal)', margin: 0 };
const muted = { color: 'var(--text-muted)', fontSize: '0.84rem', lineHeight: 1.5, margin: 0 };
const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' };
const apiError = (err, fallback) => err?.response?.data?.message || fallback;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-NA', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const SETTLED = 'paid,refund_pending,partially_refunded,refunded';

const Balance = ({ b }) => {
    const owed = b.balanceOwedCents || 0;
    return (
        <div style={card} data-testid="money-balance">
            <p style={{ ...muted, fontWeight: 600 }}>{owed < 0 ? 'You owe Bookplus' : 'Bookplus owes you'}</p>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: 700, color: owed < 0 ? '#991b1b' : 'var(--charcoal)', margin: '0.15rem 0 0.5rem' }} data-testid="money-owed">
                {nad(Math.abs(owed))}
            </p>
            {owed < 0 && <p style={{ ...muted, marginBottom: '0.5rem' }}>Refunds took more than you had. It comes off your next payments.</p>}
            <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
                {b.refundsPendingCents > 0 && <div style={row}><span>Refunds on their way</span><span>{nad(b.refundsPendingCents)}</span></div>}
                <div style={row}><span>Paid online this month</span><span>{nad(b.paidOnlineThisMonthCents)}</span></div>
                <div style={row}><span>Paid out this month</span><span>{nad(b.paidOutThisMonthCents)}</span></div>
                <div style={row}>
                    <span>Last payout</span>
                    <span style={{ textAlign: 'right' }}>{b.lastPayout ? `${nad(b.lastPayout.amountCents)}, ${day(b.lastPayout.paidAt)}` : 'None yet'}</span>
                </div>
            </div>
            {b.payoutSchedule && <p style={{ ...muted, marginTop: '0.75rem' }}>Bookplus pays into your bank account {payoutScheduleText(b.payoutSchedule)}.</p>}
        </div>
    );
};

const FeeLines = ({ p }) => {
    const f = p.fees;
    if (!f) return null;
    const lines = [
        ['Client paid', p.amountCents],
        [f.minCommissionApplied
            ? 'Bookplus commission (the minimum)'
            : `Bookplus commission${f.commissionBps ? ` (${(f.commissionBps / 100).toLocaleString('en-NA', { maximumFractionDigits: 2 })}%${f.fixedFeeCents ? ' + fixed fee' : ''})` : ''}`, -f.commissionCents],
        ...(f.processingFeeCents && f.processingFeePayer === 'business' ? [['Card processing fee', -f.processingFeeCents]] : []),
        ...(p.refundedCents ? [['Refunded to the client', -p.refundedCents]] : []),
    ];
    return (
        <div style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed var(--border)' }}>
            {lines.map(([k, v]) => <div key={k} style={row}><span>{k}</span><span>{nad(v)}</span></div>)}
            {!p.refundedCents && <div style={{ ...row, fontWeight: 600, color: 'var(--charcoal)' }}><span>You get</span><span>{nad(f.businessShareCents)}</span></div>}
        </div>
    );
};

const PaymentRow = ({ p, onRefund, onRetry, busy }) => {
    const [open, setOpen] = useState(false);
    const a = p.appointment || {};
    const stuck = stuckRefund(p);
    return (
        <li style={{ listStyle: 'none', borderTop: '1px solid var(--border)', padding: '0.75rem 0' }} data-testid="money-payment">
            <div style={row}>
                <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, color: 'var(--charcoal)', fontSize: '0.9rem', overflowWrap: 'anywhere' }}>
                        {[a.clientName, a.service].filter(Boolean).join(' · ') || 'Booking'}
                    </span>
                    <span style={{ display: 'block', ...muted, fontSize: '0.78rem' }}>
                        {a.appointmentDate ? `${day(a.appointmentDate)}, ${a.startTime}` : day(p.paidAt || p.createdAt)}
                    </span>
                </span>
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, color: 'var(--charcoal)', fontSize: '0.9rem' }}>{nad(p.amountCents)}</span>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: p.status === 'refunded' ? '#991b1b' : '#166534' }} data-testid="money-payment-status">{paymentStatusText(p)}</span>
                </span>
            </div>
            {p.refundRequest && <p style={{ ...muted, fontSize: '0.78rem', marginTop: '0.35rem' }}>Waiting for Bookplus to approve a {nad(p.refundRequest.amountCents)} refund.</p>}
            {stuck && <p style={{ ...muted, fontSize: '0.78rem', marginTop: '0.35rem', color: '#92400e' }}>The card processor did not take the {nad(stuck.amountCents)} refund yet.</p>}
            {open && <FeeLines p={p} />}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                {p.fees && (
                    <button type="button" className="btn-outline" style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                        {open ? 'Hide fees' : 'Fees'}
                    </button>
                )}
                {p.refundableCents > 0 && !p.refundRequest && (
                    <button type="button" className="btn-outline" style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }} onClick={() => onRefund(p)}>Refund</button>
                )}
                {stuck && (
                    <button type="button" className="btn-outline" style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }} disabled={busy} onClick={() => onRetry(p, stuck)}>Send the refund again</button>
                )}
            </div>
        </li>
    );
};

const PaymentsMoney = () => {
    const toast = useToast();
    const [balance, setBalance] = useState(null);
    const [pays, setPays] = useState({ data: [], page: 1, pages: 1 });
    const [ledger, setLedger] = useState({ data: [], page: 1, pages: 1 });
    const [error, setError] = useState('');
    const [refunding, setRefunding] = useState(null);
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        try {
            const [b, p, l] = await Promise.all([
                onlinePaymentsService.balance(),
                onlinePaymentsService.payments({ status: SETTLED, limit: 10 }),
                onlinePaymentsService.ledger(1, 20),
            ]);
            setBalance(b.data.data);
            setPays({ data: p.data.data, page: 1, pages: p.data.pages || 1 });
            setLedger({ data: l.data.data, page: 1, pages: l.data.pages || 1 });
            setError('');
        } catch (err) { setError(apiError(err, 'Could not load your money.')); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const more = async (kind) => {
        setBusy(kind);
        try {
            if (kind === 'payments') {
                const next = pays.page + 1;
                const r = await onlinePaymentsService.payments({ status: SETTLED, limit: 10, page: next });
                setPays((x) => ({ data: [...x.data, ...r.data.data], page: next, pages: r.data.pages || x.pages }));
            } else {
                const next = ledger.page + 1;
                const r = await onlinePaymentsService.ledger(next, 20);
                setLedger((x) => ({ data: [...x.data, ...r.data.data], page: next, pages: r.data.pages || x.pages }));
            }
        } catch (err) { toast(apiError(err, 'Could not load more.'), 'error'); }
        setBusy('');
    };

    const downloadCsv = async () => {
        setBusy('csv');
        try {
            const res = await onlinePaymentsService.statementCsv();
            const url = URL.createObjectURL(res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `bookplus-statement-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { toast('Could not prepare the statement. Try again.', 'error'); }
        setBusy('');
    };

    const retry = async (p, stuck) => {
        setBusy('retry');
        try {
            const r = await onlinePaymentsService.retryRefund(p._id, stuck._id);
            toast(r.data?.success ? 'Refund sent' : (r.data?.message || 'Not taken yet.'), r.data?.success ? 'success' : 'info');
            await load();
        } catch (err) { toast(apiError(err, 'Could not send it.'), 'error'); }
        setBusy('');
    };

    if (error) return <div style={{ ...card, color: '#991b1b', fontSize: '0.88rem' }}>{error}</div>;
    if (!balance) return <div style={{ ...card, ...muted }}>Loading your money…</div>;

    return (
        <>
            <Balance b={balance} />

            <div style={card} data-testid="money-payments">
                <h3 style={h3}>Paid online</h3>
                {pays.data.length === 0
                    ? <p style={{ ...muted, marginTop: '0.4rem' }}>No bookings paid online yet.</p>
                    : (
                        <ul style={{ margin: '0.5rem 0 0', padding: 0 }}>
                            {pays.data.map((p) => <PaymentRow key={p._id} p={p} busy={busy === 'retry'} onRefund={setRefunding} onRetry={retry} />)}
                        </ul>
                    )}
                {pays.page < pays.pages && (
                    <button type="button" className="btn-outline" style={{ width: '100%', marginTop: '0.5rem' }} disabled={busy === 'payments'} onClick={() => more('payments')}>Show more</button>
                )}
            </div>

            <div style={card} data-testid="money-statement">
                <div style={{ ...row, alignItems: 'center', flexWrap: 'wrap' }}>
                    <h3 style={h3}>Statement</h3>
                    <button type="button" className="btn-outline" style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }} disabled={busy === 'csv' || ledger.data.length === 0} onClick={downloadCsv}>
                        {busy === 'csv' ? 'Preparing…' : 'Download (CSV)'}
                    </button>
                </div>
                {ledger.data.length === 0
                    ? <p style={{ ...muted, marginTop: '0.4rem' }}>Every payment, fee, refund and payout will be listed here.</p>
                    : (
                        <ul style={{ margin: '0.5rem 0 0', padding: 0 }}>
                            {ledger.data.map((e) => (
                                <li key={e._id} style={{ listStyle: 'none', borderTop: '1px solid var(--border)', padding: '0.55rem 0', ...row }} data-testid="money-statement-row">
                                    <span style={{ minWidth: 0 }}>
                                        <span style={{ display: 'block', fontSize: '0.86rem', color: 'var(--charcoal)', overflowWrap: 'anywhere' }}>{e.description}</span>
                                        <span style={{ display: 'block', ...muted, fontSize: '0.74rem' }}>{day(e.date)}</span>
                                    </span>
                                    <span style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, color: e.amountCents < 0 ? 'var(--text-secondary)' : '#166534' }}>{e.amountCents > 0 ? '+' : ''}{nad(e.amountCents)}</span>
                                        <span style={{ display: 'block', ...muted, fontSize: '0.74rem' }}>{nad(e.balanceAfterCents)}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                {ledger.page < ledger.pages && (
                    <button type="button" className="btn-outline" style={{ width: '100%', marginTop: '0.5rem' }} disabled={busy === 'ledger'} onClick={() => more('ledger')}>Show more</button>
                )}
            </div>

            {refunding && (
                <RefundDialog
                    paymentId={refunding._id}
                    refundableCents={refunding.refundableCents}
                    title={[refunding.appointment?.clientName, refunding.appointment?.service].filter(Boolean).join(' · ')}
                    onClose={() => setRefunding(null)}
                    onDone={({ code, message }) => {
                        setRefunding(null);
                        toast(message, code === 'refunded' ? 'success' : 'info', 6000);
                        load();
                    }}
                />
            )}
        </>
    );
};

export default PaymentsMoney;
