import React, { useCallback, useEffect, useState } from 'react';
import { financeService } from '../services';
import { useToast } from './Toast';
import { uploadDisputeEvidence, VERIFICATION_ACCEPT } from '../utils/uploadImage';
import { nad, parseCents } from '../utils/onlinePayment';
import { panel as card, muted, input, label, small, list, bad } from './admin/ui';

// The admin console's Money → Payments, Payouts and Disputes: payments that
// need a look ("ask PayGate", refunds), the payout run (prepare, bank file,
// paid or returned), and card chargebacks and complaints. Same gate as the rest
// of the Money tab; an expired two-step session calls onLocked.


const h3 = { fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--charcoal)', margin: 0 };
const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' };
const apiError = (err, fallback) => err?.response?.data?.message || err?.message || fallback;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-NA', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const isLocked = (err) => err?.response?.data?.code === 'mfa_required';
// One choice in a row of choices (wrapped in .adm-seg).
const Chip = ({ on, onClick, children }) => (
    <button type="button" onClick={onClick} aria-pressed={on}>{children}</button>
);

const STATUS_TEXT = {
    initiated: 'Started', pending: 'At PayGate', paid: 'Paid', failed: 'Not paid', cancelled: 'Cancelled', expired: 'Time ran out',
    refund_pending: 'Refund on its way', partially_refunded: 'Partly refunded', refunded: 'Refunded',
};

const download = (blob, name) => {
    const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/* ───────────────────────── payments ───────────────────────── */

const CASE_KINDS = [['service_not_provided', 'Service not provided'], ['chargeback', 'Card chargeback'], ['other', 'Something else']];

const PaymentCard = ({ p, onChanged, onLocked, onCaseOpened }) => {
    const toast = useToast();
    const [open, setOpen] = useState(''); // '' | 'refund' | 'case'
    const [busy, setBusy] = useState(false);
    const [f, setF] = useState({});
    const a = p.appointment || {};
    const stuck = (p.refunds || []).find((r) => r.gatewayStatus === 'failed');
    const run = async (fn, done) => {
        setBusy(true);
        try {
            const r = await fn();
            toast(r?.data?.message || done, r?.status === 202 ? 'info' : 'success', 6000);
            setOpen(''); setF({});
            onChanged(r?.data?.data && r.data.data._id === p._id ? r.data.data : null);
            return r;
        } catch (err) {
            if (isLocked(err)) onLocked();
            else toast(apiError(err, 'That did not work.'), 'error');
            return null;
        } finally { setBusy(false); }
    };
    const refund = () => {
        const cents = f.amount ? parseCents(f.amount) : undefined;
        if (f.amount && !cents) { toast('Enter the amount, like 50.00', 'error'); return; }
        run(() => financeService.prepareRefund(p._id, { amountCents: cents, reason: (f.reason || '').trim() }), 'Done');
    };
    const openCase = async () => {
        const cents = f.amount ? parseCents(f.amount) : undefined;
        if (f.amount && !cents) { toast('Enter the amount, like 50.00', 'error'); return; }
        const r = await run(() => financeService.openDispute({
            paymentId: p._id, kind: f.kind || 'service_not_provided', summary: (f.summary || '').trim(),
            amountCents: cents, deadlineAt: f.deadline || undefined, caseReference: (f.caseReference || '').trim() || undefined,
        }), 'Case opened');
        if (r) onCaseOpened(r.data.data._id);
    };
    return (
        <div style={card} data-testid="ops-payment">
            <div style={row}>
                <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, color: 'var(--charcoal)', fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{p.provider?.businessName || p.provider?.name || 'Business'}</span>
                    <span style={{ display: 'block', ...muted, overflowWrap: 'anywhere' }}>
                        {[a.clientName, a.service].filter(Boolean).join(' · ')}{a.appointmentDate ? ` · ${day(a.appointmentDate)} ${a.startTime || ''}` : ''}
                    </span>
                </span>
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem' }}>{nad(p.amountCents)}</span>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }} data-testid="ops-payment-status">{STATUS_TEXT[p.status] || p.status}</span>
                </span>
            </div>
            <p style={{ ...muted, fontSize: '0.74rem', marginTop: '0.3rem', fontFamily: 'ui-monospace, monospace', overflowWrap: 'anywhere' }}>{p.reference}{p.refundedCents ? ` · refunded ${nad(p.refundedCents)}` : ''}</p>
            {p.flagged && <p style={{ ...muted, color: bad, marginTop: '0.3rem' }}>Flagged: {p.flagReason || 'check it'}</p>}
            {stuck && <p style={{ ...muted, color: 'var(--warning-fg)', marginTop: '0.3rem' }}>A {nad(stuck.amountCents)} refund did not go through: {stuck.error || 'PayGate refused it'}</p>}
            {p.refundRequest && <p style={{ ...muted, marginTop: '0.3rem' }}>A {nad(p.refundRequest.amountCents)} refund waits for a director.</p>}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                <button type="button" className="btn-outline" style={small} disabled={busy} onClick={() => run(() => financeService.syncPayment(p._id), 'Checked')}>Ask PayGate</button>
                {p.refundableCents > 0 && <button type="button" className="btn-outline" style={small} onClick={() => setOpen(open === 'refund' ? '' : 'refund')} aria-expanded={open === 'refund'}>Refund</button>}
                {stuck && <button type="button" className="btn-outline" style={small} disabled={busy} onClick={() => run(() => financeService.retryRefund(p._id, stuck._id), 'Refund sent')}>Send the refund again</button>}
                {['paid', 'partially_refunded', 'refund_pending', 'refunded'].includes(p.status) && (
                    <button type="button" className="btn-outline" style={small} onClick={() => setOpen(open === 'case' ? '' : 'case')} aria-expanded={open === 'case'}>Open a case</button>
                )}
            </div>
            {open === 'refund' && (
                <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <div>
                        <label style={label} htmlFor={`ref-amt-${p._id}`}>Amount (empty = all {nad(p.refundableCents)})</label>
                        <input id={`ref-amt-${p._id}`} style={input} inputMode="decimal" value={f.amount || ''} onChange={(e) => setF({ ...f, amount: e.target.value })} />
                    </div>
                    <div>
                        <label style={label} htmlFor={`ref-why-${p._id}`}>Why</label>
                        <input id={`ref-why-${p._id}`} style={input} value={f.reason || ''} onChange={(e) => setF({ ...f, reason: e.target.value })} />
                    </div>
                    <p style={muted}>Above the approval limit, it waits for a director who did not prepare it.</p>
                    <button type="button" className="btn-primary" disabled={busy || !(f.reason || '').trim()} onClick={refund}>Prepare the refund</button>
                </div>
            )}
            {open === 'case' && (
                <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <div>
                        <label style={label} htmlFor={`case-kind-${p._id}`}>What happened</label>
                        <select id={`case-kind-${p._id}`} style={input} value={f.kind || 'service_not_provided'} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                            {CASE_KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={label} htmlFor={`case-sum-${p._id}`}>What it is about</label>
                        <textarea id={`case-sum-${p._id}`} rows={2} style={{ ...input, resize: 'vertical' }} value={f.summary || ''} onChange={(e) => setF({ ...f, summary: e.target.value })} />
                    </div>
                    <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9rem), 1fr))' }}>
                        <div>
                            <label style={label} htmlFor={`case-amt-${p._id}`}>Amount (empty = all)</label>
                            <input id={`case-amt-${p._id}`} style={input} inputMode="decimal" value={f.amount || ''} onChange={(e) => setF({ ...f, amount: e.target.value })} />
                        </div>
                        <div>
                            <label style={label} htmlFor={`case-due-${p._id}`}>Evidence due</label>
                            <input id={`case-due-${p._id}`} type="date" style={input} value={f.deadline || ''} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
                        </div>
                        <div>
                            <label style={label} htmlFor={`case-ref-${p._id}`}>Case number</label>
                            <input id={`case-ref-${p._id}`} style={input} value={f.caseReference || ''} onChange={(e) => setF({ ...f, caseReference: e.target.value })} />
                        </div>
                    </div>
                    <button type="button" className="btn-primary" disabled={busy || !(f.summary || '').trim()} onClick={openCase}>Open the case</button>
                </div>
            )}
        </div>
    );
};

const PAYMENT_VIEWS = [['attention', 'Needs a look'], ['paid', 'Paid'], ['all', 'All']];

export const PaymentsView = ({ onLocked, onCaseOpened }) => {
    const [view, setView] = useState('attention');
    const [q, setQ] = useState('');
    const [rows, setRows] = useState(null);
    const [pages, setPages] = useState({ page: 1, pages: 1 });
    const [error, setError] = useState('');

    const params = useCallback((page) => ({
        page, limit: 20,
        ...(view === 'attention' ? { view: 'attention' } : {}),
        ...(view === 'paid' ? { status: 'paid,partially_refunded,refund_pending,refunded' } : {}),
        ...(q.trim() ? { reference: q.trim() } : {}),
    }), [view, q]);
    const load = useCallback(async (page = 1) => {
        try {
            const r = await financeService.payments(params(page));
            setRows((old) => (page === 1 ? r.data.data : [...(old || []), ...r.data.data]));
            setPages({ page, pages: r.data.pages || 1 });
            setError('');
        } catch (err) {
            if (isLocked(err)) onLocked();
            else setError(apiError(err, 'Could not load the payments.'));
        }
    }, [params, onLocked]);
    useEffect(() => { load(1); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div style={list} data-testid="ops-payments">
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="adm-seg" role="group" aria-label="Show">
                    {PAYMENT_VIEWS.map(([k, t]) => <Chip key={k} on={view === k} onClick={() => setView(k)}>{t}</Chip>)}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); load(1); }} style={{ flex: '1 1 12rem', display: 'flex', gap: '0.4rem' }}>
                    <input aria-label="Payment reference" placeholder="Reference (BP…)" style={{ ...input, flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} />
                    <button type="submit" className="btn-outline" style={small}>Find</button>
                </form>
            </div>
            {view === 'attention' && <p style={muted}>Payments still open after 15 minutes, flagged ones, and refunds that did not go through.</p>}
            {error && <p role="alert" style={{ ...muted, color: bad }}>{error}</p>}
            {!rows && !error && <p style={muted}>Loading…</p>}
            {rows && rows.length === 0 && <div style={card}><p style={muted}>{view === 'attention' ? 'Nothing needs a look.' : 'No payments.'}</p></div>}
            {(rows || []).map((p) => (
                <PaymentCard key={p._id} p={p} onLocked={onLocked} onCaseOpened={onCaseOpened}
                    onChanged={(fresh) => (fresh ? setRows((rs) => rs.map((x) => (x._id === fresh._id ? fresh : x))) : load(1))} />
            ))}
            {pages.page < pages.pages && <button type="button" className="btn-outline" onClick={() => load(pages.page + 1)}>Show more</button>}
        </div>
    );
};

/* ───────────────────────── payouts ───────────────────────── */

const BLOCKED = {
    payout_account_missing: 'No bank account added',
    payout_account_unchecked: 'New bank account not checked yet (Approvals)',
    payout_pending: 'A payout is already on its way',
    below_threshold: 'Below the payout minimum',
    busy: 'Busy, try again',
    not_found: 'Business not found',
};
const FREQ = { weekly: (w) => `every ${w}`, biweekly: (w) => `every second ${w}`, monthly: () => 'once a month' };

const PendingPayout = ({ p, onDone, onLocked }) => {
    const toast = useToast();
    const [mode, setMode] = useState('');
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        setBusy(true);
        try {
            const r = mode === 'paid' ? await financeService.payoutPaid(p._id, value.trim()) : await financeService.payoutFailed(p._id, value.trim());
            toast(r.data.message, 'success');
            setMode(''); setValue('');
            onDone();
        } catch (err) {
            if (isLocked(err)) onLocked();
            else toast(apiError(err, 'That did not work.'), 'error');
        }
        setBusy(false);
    };
    return (
        <div style={card} data-testid="ops-payout">
            <div style={row}>
                <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{p.provider?.businessName || p.provider?.name}</span>
                    <span style={{ display: 'block', ...muted }}>{p.bankName} {p.accountNumberMasked} · ref {p.ourReference}</span>
                </span>
                <span style={{ fontWeight: 600, flexShrink: 0 }}>{nad(p.amountCents)}</span>
            </div>
            {!mode ? (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                    <button type="button" className="btn-outline" style={small} onClick={() => { setMode('paid'); setValue(''); }}>Paid</button>
                    <button type="button" className="btn-outline" style={small} onClick={() => { setMode('failed'); setValue(''); }}>Returned by the bank</button>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.6rem' }}>
                    <label style={label} htmlFor={`po-${p._id}`}>{mode === 'paid' ? 'The bank\'s reference for the transfer' : 'What the bank said'}</label>
                    <input id={`po-${p._id}`} style={input} value={value} onChange={(e) => setValue(e.target.value)} />
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button type="button" className="btn-primary" style={small} disabled={busy || !value.trim()} onClick={submit}>{mode === 'paid' ? 'Mark paid' : 'Put it back on their balance'}</button>
                        <button type="button" className="btn-outline" style={small} onClick={() => setMode('')}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export const PayoutsView = ({ onLocked }) => {
    const toast = useToast();
    const [due, setDue] = useState(null);
    const [pending, setPending] = useState([]);
    const [recent, setRecent] = useState([]);
    const [chosen, setChosen] = useState({});
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const [d, p, r] = await Promise.all([
                financeService.payoutsDue(),
                financeService.payouts({ status: 'pending', limit: 100 }),
                financeService.payouts({ limit: 20 }),
            ]);
            setDue(d.data);
            setChosen(Object.fromEntries(d.data.data.filter((x) => x.payable).map((x) => [x.providerId, true])));
            setPending(p.data.data);
            setRecent(r.data.data.filter((x) => x.status !== 'pending'));
            setError('');
        } catch (err) {
            if (isLocked(err)) onLocked();
            else setError(apiError(err, 'Could not load payouts.'));
        }
    }, [onLocked]);
    useEffect(() => { load(); }, [load]);

    const ids = Object.keys(chosen).filter((k) => chosen[k]);
    const total = (due?.data || []).filter((x) => chosen[x.providerId]).reduce((s, x) => s + x.amountCents, 0);
    const prepare = async () => {
        setBusy('run');
        try {
            const r = await financeService.preparePayouts(ids);
            toast(r.data.message, 'success', 6000);
            await load();
        } catch (err) {
            if (isLocked(err)) onLocked();
            else toast(apiError(err, 'Could not prepare the payouts.'), 'error');
        }
        setBusy('');
    };
    const bankFile = async () => {
        setBusy('file');
        try {
            const r = await financeService.payoutBankFile();
            download(r.data, `bookplus-payouts-${new Date().toISOString().slice(0, 10)}.csv`);
        } catch (err) {
            if (isLocked(err)) onLocked();
            else toast('Could not prepare the bank file.', 'error');
        }
        setBusy('');
    };

    if (error) return <p role="alert" style={{ ...muted, color: bad }}>{error}</p>;
    if (!due) return <p style={muted}>Loading…</p>;
    const s = due.schedule;
    return (
        <div style={list} data-testid="ops-payouts">
            <p style={muted}>
                Payouts {(FREQ[s.frequency] || FREQ.weekly)(s.weekdayName)} (next: {day(s.nextRunDate)}), to {s.minThresholdCents > 1 ? `businesses owed at least ${nad(s.minThresholdCents)}` : 'every business Bookplus owes'}.
                Preparing a payout takes it off the business's balance at once; then make the transfers and mark each one.
            </p>

            <div style={card} data-testid="ops-payouts-due">
                <h3 style={{ ...h3, marginBottom: '0.5rem' }}>Due</h3>
                {due.data.length === 0 ? <p style={muted}>Nobody is owed enough to be paid.</p> : (
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {due.data.map((x) => (
                            <label key={x.providerId} style={{ ...row, alignItems: 'center', padding: '0.4rem 0', borderTop: '1px solid var(--border)', cursor: x.payable ? 'pointer' : 'default' }}>
                                <span style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start', minWidth: 0 }}>
                                    <input type="checkbox" disabled={!x.payable} checked={!!chosen[x.providerId]} style={{ accentColor: 'var(--gold)', marginTop: '0.2rem' }}
                                        onChange={(e) => setChosen({ ...chosen, [x.providerId]: e.target.checked })} aria-label={`Pay ${x.businessName}`} />
                                    <span style={{ minWidth: 0 }}>
                                        <span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', overflowWrap: 'anywhere' }}>{x.businessName}</span>
                                        <span style={{ display: 'block', ...muted, color: x.payable ? 'var(--text-muted)' : 'var(--warning-fg)' }}>
                                            {x.payable ? `${x.bankName} ${x.accountNumberMasked}` : BLOCKED[x.blockedBy] || x.blockedBy}
                                            {x.paymentsSwitchedOffByBookplus ? ' · online payments switched off by Bookplus' : ''}
                                        </span>
                                    </span>
                                </span>
                                <span style={{ fontWeight: 600, fontSize: '0.88rem', flexShrink: 0 }}>{nad(x.amountCents)}</span>
                            </label>
                        ))}
                        <button type="button" className="btn-primary" disabled={!ids.length || busy === 'run'} onClick={prepare}>
                            {busy === 'run' ? 'Preparing…' : `Prepare ${ids.length} payout${ids.length === 1 ? '' : 's'} (${nad(total)})`}
                        </button>
                    </div>
                )}
            </div>

            <div style={{ ...row, alignItems: 'center', flexWrap: 'wrap' }}>
                <h3 style={h3}>On their way ({pending.length})</h3>
                <button type="button" className="btn-outline" style={small} disabled={!pending.length || busy === 'file'} onClick={bankFile}>
                    {busy === 'file' ? 'Preparing…' : 'Download bank file (CSV)'}
                </button>
            </div>
            {pending.length === 0 && <p style={muted}>None.</p>}
            {pending.map((p) => <PendingPayout key={p._id} p={p} onDone={load} onLocked={onLocked} />)}

            {recent.length > 0 && (
                <div style={card}>
                    <h3 style={{ ...h3, marginBottom: '0.5rem' }}>Recent</h3>
                    {recent.map((p) => (
                        <div key={p._id} style={{ ...row, padding: '0.4rem 0', borderTop: '1px solid var(--border)', fontSize: '0.85rem' }} data-testid="ops-payout-recent">
                            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                                {p.provider?.businessName || p.provider?.name}
                                <span style={{ display: 'block', ...muted, fontSize: '0.75rem' }}>
                                    {p.status === 'failed' ? `Returned: ${p.failureReason}` : `Paid ${day(p.paidAt)}${p.reference ? `, ${p.reference}` : ''}`}
                                </span>
                            </span>
                            <span style={{ flexShrink: 0, color: p.status === 'failed' ? bad : 'var(--charcoal)' }}>{nad(p.amountCents)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

/* ───────────────────────── disputes ───────────────────────── */

const KIND_TEXT = { chargeback: 'Card chargeback', service_not_provided: 'Service not provided', other: 'Case' };
const CASE_STATUS = { open: 'Open', won: 'Won', lost: 'Lost', refunded: 'Client refunded', closed: 'Closed' };
const REQUEST_STATUS = { pending: 'waiting for a director', approved: 'approved', rejected: 'rejected', executed: 'done', failed: 'did not go through' };

const daysLeft = (d) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null);

const DisputeDetail = ({ id, onBack, onLocked }) => {
    const toast = useToast();
    const [d, setD] = useState(null);
    const [note, setNote] = useState('');
    const [action, setAction] = useState('');
    const [f, setF] = useState({});
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try { setD((await financeService.getDispute(id)).data.data); } catch (err) {
            if (isLocked(err)) onLocked();
            else toast(apiError(err, 'Could not load the case.'), 'error');
        }
    }, [id, onLocked, toast]);
    useEffect(() => { load(); }, [load]);

    const run = async (fn) => {
        setBusy(true);
        try {
            const r = await fn();
            toast(r?.data?.message || 'Saved', r?.status === 202 ? 'info' : 'success', 6000);
            setAction(''); setF({}); setNote('');
            await load();
        } catch (err) {
            if (isLocked(err)) onLocked();
            else toast(apiError(err, 'That did not work.'), 'error');
        }
        setBusy(false);
    };
    const openEvidence = async (e) => {
        const tab = window.open('about:blank', '_blank');
        if (!tab) { toast('Allow pop-ups for this site to open files.', 'error'); return; }
        tab.opener = null;
        try {
            tab.location.href = (await financeService.getDisputeEvidence(id, e._id)).data.data.url;
        } catch (err) {
            tab.close();
            toast(apiError(err, 'Could not open the file.'), 'error');
        }
    };
    const upload = async (file) => {
        if (!file) return;
        setBusy(true);
        try {
            const { ref } = await uploadDisputeEvidence(file, id);
            await financeService.addDisputeEvidence(id, { name: file.name, ref });
            toast('File added', 'success');
            await load();
        } catch (err) {
            if (isLocked(err)) onLocked();
            else toast(apiError(err, 'Could not add the file.'), 'error');
        }
        setBusy(false);
    };

    if (!d) return <p style={muted}>Loading…</p>;
    const open = d.status === 'open';
    const left = daysLeft(d.deadlineAt);
    const loss = d.amountCents + (d.feeCents || 0);
    return (
        <div style={list} data-testid="ops-dispute">
            <button type="button" className="btn-outline" style={{ ...small, justifySelf: 'start' }} onClick={onBack}>Back to cases</button>
            <div style={card}>
                <div style={row}>
                    <h3 style={h3}>{KIND_TEXT[d.kind]}: {d.provider?.businessName || d.provider?.name}</h3>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, flexShrink: 0 }} data-testid="ops-dispute-status">{CASE_STATUS[d.status]}</span>
                </div>
                <p style={{ ...muted, marginTop: '0.4rem', color: 'var(--charcoal)', overflowWrap: 'anywhere' }}>{d.summary}</p>
                <div style={{ display: 'grid', gap: '0.25rem', marginTop: '0.6rem', fontSize: '0.84rem' }}>
                    <div style={row}><span>Disputed</span><span>{nad(d.amountCents)}</span></div>
                    {d.feeCents > 0 && <div style={row}><span>Card processor's fee</span><span>{nad(d.feeCents)}</span></div>}
                    {d.caseReference && <div style={row}><span>Case number</span><span>{d.caseReference}</span></div>}
                    {d.deadlineAt && <div style={row}><span>Evidence due</span><span style={{ color: open && left !== null && left <= 3 ? bad : undefined }}>{day(d.deadlineAt)}{open && left !== null ? ` (${left < 0 ? 'passed' : `${left} day${left === 1 ? '' : 's'} left`})` : ''}</span></div>}
                    {d.payment && <div style={row}><span>Payment</span><span>{STATUS_TEXT[d.payment.status]}{d.payment.refundedCents ? `, ${nad(d.payment.refundedCents)} refunded` : ''}</span></div>}
                    {d.payment?.appointment && <div style={row}><span>Booking</span><span style={{ textAlign: 'right' }}>{[d.payment.appointment.clientName, d.payment.appointment.service].filter(Boolean).join(' · ')}, {day(d.payment.appointment.appointmentDate)}</span></div>}
                </div>
                {d.payment && <p style={{ ...muted, fontSize: '0.74rem', marginTop: '0.4rem', fontFamily: 'ui-monospace, monospace', overflowWrap: 'anywhere' }}>{d.payment.reference}</p>}
                {d.outcomeNote && <p style={{ ...muted, marginTop: '0.5rem', overflowWrap: 'anywhere' }}>Outcome: {d.outcomeNote}</p>}
                {d.requests.map((r) => (
                    <p key={r._id} style={{ ...muted, marginTop: '0.4rem' }} data-testid="ops-dispute-request">
                        {r.type === 'recovery' ? 'Recover from the business' : 'Refund to the client'} {nad(r.amountCents)}: {REQUEST_STATUS[r.status] || r.status}
                    </p>
                ))}
            </div>

            {open && (
                <div style={card}>
                    <h3 style={{ ...h3, marginBottom: '0.5rem' }}>What next</h3>
                    <div className="adm-seg" role="group" aria-label="What next">
                        {d.kind === 'chargeback' ? (
                            <>
                                <Chip on={action === 'won'} onClick={() => setAction('won')}>Won</Chip>
                                <Chip on={action === 'lost'} onClick={() => { setAction('lost'); setF({ recover: true }); }}>Lost</Chip>
                            </>
                        ) : (
                            <Chip on={action === 'refund'} onClick={() => setAction('refund')}>Refund the client</Chip>
                        )}
                        <Chip on={action === 'closed'} onClick={() => setAction('closed')}>Close</Chip>
                    </div>
                    {action === 'refund' && (
                        <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                            <label style={label} htmlFor="case-refund-amt">Amount (empty = {nad(d.amountCents)})</label>
                            <input id="case-refund-amt" style={input} inputMode="decimal" value={f.amount || ''} onChange={(e) => setF({ ...f, amount: e.target.value })} />
                            <label style={label} htmlFor="case-refund-why">Why</label>
                            <input id="case-refund-why" style={input} value={f.reason || ''} onChange={(e) => setF({ ...f, reason: e.target.value })} />
                            <p style={muted}>It comes off the business's balance. Above the approval limit, a director approves it first.</p>
                            <button type="button" className="btn-primary" disabled={busy || !(f.reason || '').trim()}
                                onClick={() => {
                                    const cents = f.amount ? parseCents(f.amount) : d.amountCents;
                                    if (!cents) { toast('Enter the amount, like 50.00', 'error'); return; }
                                    run(() => financeService.refundFromDispute(id, { amountCents: cents, reason: f.reason.trim() }));
                                }}>
                                Prepare the refund
                            </button>
                        </div>
                    )}
                    {['won', 'lost', 'closed'].includes(action) && (
                        <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                            <label style={label} htmlFor="case-outcome">How it ended</label>
                            <textarea id="case-outcome" rows={2} style={{ ...input, resize: 'vertical' }} value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} />
                            {action === 'lost' && (
                                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.86rem' }}>
                                    <input type="checkbox" checked={!!f.recover} onChange={(e) => setF({ ...f, recover: e.target.checked })} style={{ accentColor: 'var(--gold)', marginTop: '0.2rem' }} />
                                    <span>Recover {nad(loss)} (the amount{d.feeCents ? ' and the fee' : ''}) from the business's balance. A director approves it, and it can only be taken once.</span>
                                </label>
                            )}
                            <button type="button" className="btn-primary" disabled={busy || !(f.note || '').trim()}
                                onClick={() => run(() => financeService.closeDispute(id, { outcome: action, note: f.note.trim(), recover: action === 'lost' && f.recover ? {} : null }))}>
                                {action === 'closed' ? 'Close the case' : `Record: ${action}`}
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div style={card}>
                <h3 style={{ ...h3, marginBottom: '0.5rem' }}>Evidence</h3>
                {d.evidence.length === 0 && <p style={muted}>No files yet.</p>}
                {d.evidence.map((e) => (
                    <div key={e._id} style={{ ...row, alignItems: 'center', padding: '0.35rem 0', borderTop: '1px solid var(--border)' }}>
                        <span style={{ minWidth: 0, fontSize: '0.86rem', overflowWrap: 'anywhere' }}>{e.name}<span style={{ display: 'block', ...muted, fontSize: '0.74rem' }}>{e.by}, {day(e.at)}</span></span>
                        <button type="button" className="btn-outline" style={small} onClick={() => openEvidence(e)}>Open</button>
                    </div>
                ))}
                {d.uploadsAvailable && (
                    <label className="btn-outline" style={{ ...small, display: 'inline-block', marginTop: '0.6rem', cursor: busy ? 'default' : 'pointer' }}>
                        {busy ? 'Uploading…' : 'Add a file'}
                        <input type="file" accept={VERIFICATION_ACCEPT} disabled={busy} style={{ display: 'none' }} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                )}
            </div>

            <div style={card}>
                <h3 style={{ ...h3, marginBottom: '0.5rem' }}>Notes</h3>
                {d.notes.map((n) => (
                    <div key={n._id} style={{ padding: '0.35rem 0', borderTop: '1px solid var(--border)' }}>
                        <p style={{ margin: 0, fontSize: '0.86rem', overflowWrap: 'anywhere' }}>{n.text}</p>
                        <p style={{ ...muted, fontSize: '0.74rem' }}>{n.by}, {day(n.at)}</p>
                    </div>
                ))}
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                    <input aria-label="New note" placeholder="Add a note" style={{ ...input, flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} />
                    <button type="button" className="btn-outline" style={small} disabled={busy || !note.trim()} onClick={() => run(() => financeService.addDisputeNote(id, note.trim()))}>Add</button>
                </div>
            </div>
        </div>
    );
};

export const DisputesView = ({ onLocked, openId = null }) => {
    const [status, setStatus] = useState('open');
    const [rows, setRows] = useState(null);
    const [selected, setSelected] = useState(openId);
    const [error, setError] = useState('');
    useEffect(() => { if (openId) setSelected(openId); }, [openId]);

    const load = useCallback(async () => {
        try {
            setRows((await financeService.disputes(status)).data.data);
            setError('');
        } catch (err) {
            if (isLocked(err)) onLocked();
            else setError(apiError(err, 'Could not load the cases.'));
        }
    }, [status, onLocked]);
    useEffect(() => { if (!selected) load(); }, [load, selected]);

    if (selected) return <DisputeDetail id={selected} onBack={() => setSelected(null)} onLocked={onLocked} />;
    return (
        <div style={list} data-testid="ops-disputes">
            <div className="adm-seg" role="group" aria-label="Cases" style={{ justifySelf: 'start' }}>
                <Chip on={status === 'open'} onClick={() => setStatus('open')}>Open</Chip>
                <Chip on={status === 'closed'} onClick={() => setStatus('closed')}>Closed</Chip>
            </div>
            <p style={muted}>Card chargebacks and complaints that a paid service was not provided. Open a case from a payment (Payments).</p>
            {error && <p role="alert" style={{ ...muted, color: bad }}>{error}</p>}
            {!rows && !error && <p style={muted}>Loading…</p>}
            {rows && rows.length === 0 && <div style={card}><p style={muted}>{status === 'open' ? 'No open cases.' : 'No closed cases yet.'}</p></div>}
            {(rows || []).map((d) => {
                const left = daysLeft(d.deadlineAt);
                return (
                    <button key={d._id} type="button" onClick={() => setSelected(d._id)} style={{ ...card, textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-body)', width: '100%' }} data-testid="ops-dispute-row">
                        <span style={{ ...row, display: 'flex' }}>
                            <span style={{ minWidth: 0 }}>
                                <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', color: 'var(--charcoal)', overflowWrap: 'anywhere' }}>{d.provider?.businessName || d.provider?.name}</span>
                                <span style={{ display: 'block', ...muted }}>{KIND_TEXT[d.kind]} · {CASE_STATUS[d.status]}</span>
                            </span>
                            <span style={{ textAlign: 'right', flexShrink: 0 }}>
                                <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', color: 'var(--charcoal)' }}>{nad(d.amountCents)}</span>
                                {d.status === 'open' && left !== null && <span style={{ display: 'block', fontSize: '0.74rem', color: left <= 3 ? bad : 'var(--text-muted)' }}>{left < 0 ? 'Deadline passed' : `Due in ${left} day${left === 1 ? '' : 's'}`}</span>}
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
};
