import React, { useCallback, useEffect, useState } from 'react';
import { financeService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { useToast } from './Toast';
import PaygateCheck from './PaygateCheck';
import SubscriptionsView from './SubscriptionsView';
import { TWO_STEP_EVENT } from './AdminTwoStep';
import { panel as card, h3, muted, input, label, errBox, th, td, Status } from './admin/ui';

// The admin console's Money and Settings sections: the business subscription
// plan's prices and VAT, the launch checklist and PayGate check, the financial
// audit log and who holds the money roles. (Bookplus takes card payments only
// for business subscriptions: no booking payments, no commission.) The console sits
// behind two-step sign-in; when the 12 hours run out mid-session the API
// refuses and the console asks for the code again (onLocked).

const nad = (cents) => {
    if (cents === null || cents === undefined) return '—';
    const neg = cents < 0;
    const s = (Math.abs(cents) / 100).toLocaleString('en-NA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${neg ? '-' : ''}N$${s}`;
};
const when = (d) => (d ? new Date(d).toLocaleString('en-NA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const apiError = (err, fallback) => err?.response?.data?.message || fallback;

/* ───────────────────────── prices and fees ───────────────────────── */

// [path, label, kind, options]. Kinds: money (cents), int, num, text, bool.
const SECTIONS = [
    { title: 'Basic plan', items: [
        ['plans.basic.trialDays', 'Free trial (days)', 'int'],
        ['plans.basic.introMonths', 'Months at the introductory price', 'int'],
        ['plans.basic.introPriceCents', 'Introductory price a month', 'money'],
        ['plans.basic.priceCents', 'Price a month after that', 'money'],
        ['plans.basic.priceChangeNoticeDays', 'Notice before the price changes (days)', 'int'],
    ] },
    { title: 'VAT', items: [
        ['vat.registered', 'Bookplus is VAT registered', 'bool'],
        ['vat.number', 'VAT number', 'text'],
        ['vat.ratePct', 'VAT rate (%)', 'num'],
    ] },
];

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const setPath = (obj, path, v) => {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; });
    o[keys[keys.length - 1]] = v;
    return obj;
};
const toField = (kind, v) => {
    if (kind === 'bool') return !!v;
    if (v === null || v === undefined) return '';
    if (kind.startsWith('money')) return (v / 100).toFixed(2);
    if (kind.startsWith('pct')) return String(v / 100);
    return String(v);
};
// The stored value for a field, or undefined when it isn't valid.
const fromField = (kind, s, options) => {
    if (kind === 'bool') return !!s;
    if (kind === 'text') return String(s).trim();
    if (kind === 'select') {
        const opt = options.find(([v]) => String(v) === String(s));
        return opt ? opt[0] : undefined;
    }
    const raw = String(s).trim();
    if (raw === '') return kind.endsWith('?') ? null : undefined;
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return undefined;
    if (kind.startsWith('money') || kind.startsWith('pct')) return Math.round(n * 100);
    if (kind === 'int') return Number.isInteger(n) ? n : undefined;
    return n;
};

const LAUNCH_LABELS = {
    providerApproved: 'PayGate approved recurring billing on both terminals in writing',
    pricingApproved: 'The owner approved the plan\'s prices',
    legalCleared: 'Legal clearance is on record',
    termsReviewed: 'A lawyer reviewed the plan terms and Privacy Policy',
    liveTestPassed: 'A live first payment and monthly charge went through',
};

const Settings = ({ data, isDirector, onSaved, onLocked }) => {
    const toast = useToast();
    const initial = () => Object.fromEntries(SECTIONS.flatMap((sec) => sec.items.map(([p, , k]) => [p, toField(k, getPath(data.settings, p))])));
    const [form, setForm] = useState(initial);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { setForm(initial()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [data]);

    const changed = [];
    const bad = [];
    SECTIONS.forEach((sec) => sec.items.forEach(([p, l, k, opts]) => {
        const v = fromField(k, form[p], opts);
        if (v === undefined) bad.push(l);
        else if (v !== getPath(data.settings, p) && !(v === null && getPath(data.settings, p) == null)) changed.push([p, v]);
    }));

    const save = async (e) => {
        e.preventDefault();
        if (bad.length) { setError(`Check: ${bad.join(', ')}`); return; }
        setBusy(true); setError('');
        try {
            const nested = changed.reduce((o, [p, v]) => setPath(o, p, v), {});
            const res = await financeService.updateSettings(nested, reason.trim());
            toast(`Saved (version ${res.data.data.settings.version})`, 'success');
            setReason('');
            onSaved(res.data.data);
        } catch (err) {
            if (err?.response?.data?.code === 'mfa_required') onLocked();
            setError(apiError(err, 'Could not save.'));
        }
        setBusy(false);
    };

    return (
        <form onSubmit={save} style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(0, 1fr)' }}>
            {!isDirector && <p style={muted}>Only a director can change these. You can read them.</p>}
            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 19rem), 1fr))' }}>
                {SECTIONS.map((sec) => (
                    <fieldset key={sec.title} style={{ ...card, margin: 0, minWidth: 0 }} disabled={!isDirector}>
                        <legend style={{ ...h3, padding: 0, float: 'left', width: '100%' }}>{sec.title}</legend>
                        {sec.note && <p style={{ ...muted, clear: 'both', marginBottom: '0.75rem', fontSize: '0.8rem' }}>{sec.note}</p>}
                        <div style={{ clear: 'both', display: 'grid', gap: '0.7rem' }}>
                            {sec.items.map(([p, l, k, opts]) => (
                                <div key={p}>
                                    {k === 'bool' ? (
                                        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.88rem' }}>
                                            <input type="checkbox" checked={!!form[p]} onChange={(e) => setForm((f) => ({ ...f, [p]: e.target.checked }))} style={{ accentColor: 'var(--charcoal)' }} /> {l}
                                        </label>
                                    ) : (
                                        <>
                                            <label style={label} htmlFor={`fin-${p}`}>
                                                {l}{k.startsWith('money') ? ' (N$)' : k.startsWith('pct') ? ' (%)' : ''}
                                            </label>
                                            {k === 'select' ? (
                                                <select id={`fin-${p}`} value={form[p]} onChange={(e) => setForm((f) => ({ ...f, [p]: e.target.value }))} style={input}>
                                                    {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                                                </select>
                                            ) : (
                                                <input id={`fin-${p}`} value={form[p]} inputMode={k === 'text' ? 'text' : 'decimal'}
                                                    placeholder={k.endsWith('?') ? 'Not known yet' : ''}
                                                    onChange={(e) => setForm((f) => ({ ...f, [p]: e.target.value }))} style={input} />
                                            )}
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </fieldset>
                ))}
            </div>
            {isDirector && (
                <div style={{ ...card, display: 'grid', gap: '0.75rem' }}>
                    {error && <div role="alert" style={errBox}>{error}</div>}
                    <div>
                        <label style={label} htmlFor="fin-reason">Why are these changing? (kept in the audit log)</label>
                        <input id="fin-reason" value={reason} onChange={(e) => setReason(e.target.value)} style={input} placeholder="e.g. New price list from 1 January" />
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button type="submit" className="btn-primary" disabled={busy || !changed.length || !reason.trim()}>
                            {busy ? 'Saving…' : `Save ${changed.length || ''} change${changed.length === 1 ? '' : 's'}`.replace('  ', ' ')}
                        </button>
                        <span style={muted}>Version {data.settings.version}. Businesses keep the prices fixed when their trial started.</span>
                    </div>
                </div>
            )}
        </form>
    );
};

const Launch = ({ launch, isDirector, onChanged, onLocked }) => {
    const toast = useToast();
    const [noteFor, setNoteFor] = useState(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const manual = new Set(['providerApproved', 'pricingApproved', 'legalCleared', 'termsReviewed', 'liveTestPassed']);
    const act = async (key, done) => {
        setBusy(true);
        try {
            const res = await financeService.setLaunchGate(key, done, note.trim());
            onChanged(res.data.data);
            setNoteFor(null); setNote('');
        } catch (err) {
            if (err?.response?.data?.code === 'mfa_required') onLocked();
            toast(apiError(err, 'Could not save.'), 'error');
        }
        setBusy(false);
    };
    return (
        <div style={card}>
            <h3 style={h3}>Before businesses pay for their plan</h3>
            <p style={{ ...muted, marginBottom: '0.75rem' }}>
                {launch.ready ? 'Everything is in place. Switching plan billing on is still a server setting.' : 'Plan billing stays off until every item is done.'}
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
                {launch.items.map((i) => (
                    <li key={i.key} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }} data-testid={`launch-${i.key}`}>
                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0, flex: '1 1 14rem' }}>
                                <span style={{ marginRight: '0.6rem' }}><Status tone={i.done ? 'ok' : 'warn'}>{i.done ? 'Done' : 'To do'}</Status></span>
                                <span style={{ fontSize: '0.88rem' }}>{LAUNCH_LABELS[i.key] || i.key}</span>
                                {i.note && <p style={{ ...muted, fontSize: '0.78rem' }}>{i.note}{i.at ? `, ${when(i.at)}` : ''}</p>}
                            </div>
                            {isDirector && manual.has(i.key) && noteFor !== i.key && (
                                i.done
                                    ? <button type="button" className="btn-outline" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} disabled={busy} onClick={() => act(i.key, false)}>Undo</button>
                                    : <button type="button" className="btn-outline" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} onClick={() => { setNoteFor(i.key); setNote(''); }}>Mark done</button>
                            )}
                        </div>
                        {noteFor === i.key && (
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What confirmed it (email, document, date)" style={{ ...input, flex: '1 1 14rem' }} aria-label="What confirmed it" />
                                <button type="button" className="btn-primary" disabled={busy || !note.trim()} onClick={() => act(i.key, true)}>Save</button>
                                <button type="button" className="btn-outline" onClick={() => setNoteFor(null)}>Cancel</button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
};

/* ───────────────────────── audit log ───────────────────────── */

const ACTION_LABELS = {
    'settings.update': 'Changed plan prices', 'launch.confirm': 'Confirmed a launch item', 'launch.unconfirm': 'Undid a launch item',
    'business.pricing': 'Changed a business\'s plan', 'refund.request': 'Asked for a refund', 'refund.approve': 'Approved a refund',
    'refund.reject': 'Rejected a refund', 'refund.execute': 'Refunded', 'refund.fail': 'Refund did not go through', 'refund.owner': 'Business refunded',
    'adjustment.request': 'Asked for an adjustment', 'adjustment.approve': 'Approved an adjustment', 'adjustment.reject': 'Rejected an adjustment',
    'adjustment.execute': 'Adjusted a balance', 'adjustment.fail': 'Adjustment failed', 'payout.record': 'Recorded a payout',
    'roles.update': 'Changed money roles', 'security.mfa_enabled': 'Turned on two-step sign-in', 'security.mfa_reset': 'Reset two-step sign-in', 'security.admin_locked': 'Suspended an admin (server)', 'security.role_change': 'Changed an account\'s role',
    'subscription.trial_start': 'Started a business\'s free trial', 'subscription.keep_free': 'Kept a business free', 'subscription.visibility': 'Showed or hid plans for businesses',
    'payment.sync': 'Asked PayGate about a payment', 'refund.retry': 'Sent a refund again', 'refund.retry_fail': 'Refund still not taken',
    'payout.prepare': 'Prepared a payout', 'payout.paid': 'Marked a payout paid', 'payout.failed': 'Payout returned by the bank',
    'payout.bank_file': 'Downloaded the payout bank file', 'dispute.open': 'Opened a case', 'dispute.evidence': 'Added evidence to a case',
    'dispute.evidence_view': 'Opened case evidence', 'dispute.won': 'Chargeback won', 'dispute.lost': 'Chargeback lost', 'dispute.closed': 'Closed a case',
    'recovery.request': 'Asked to recover a chargeback', 'recovery.approve': 'Approved a chargeback recovery', 'recovery.reject': 'Rejected a chargeback recovery',
    'recovery.execute': 'Recovered a chargeback', 'recovery.fail': 'Chargeback recovery did not run',
};

const Audit = ({ onLocked }) => {
    const [rows, setRows] = useState(null);
    const [next, setNext] = useState(null);
    const load = useCallback(async (before) => {
        try {
            const res = await financeService.getAudit(before ? { before } : {});
            setRows((r) => (before ? [...(r || []), ...res.data.data] : res.data.data));
            setNext(res.data.next);
        } catch (err) {
            if (err?.response?.data?.code === 'mfa_required') onLocked();
            setRows((r) => r || []);
        }
    }, [onLocked]);
    useEffect(() => { load(); }, [load]);
    if (!rows) return <p style={muted}>Loading…</p>;
    return (
        <div style={card}>
            <h3 style={h3}>Audit log</h3>
            <p style={{ ...muted, marginBottom: '0.75rem' }}>Every money action, who did it and why. Entries can't be changed or deleted.</p>
            {!rows.length ? <p style={muted}>Nothing yet.</p> : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {rows.map((r) => {
                        const business = r.provider?.businessProfile?.businessName || r.provider?.name || '';
                        return (
                            <li key={r._id} data-testid="audit-row" style={{ borderTop: '1px solid var(--border)', padding: '0.6rem 0' }}>
                                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem', overflowWrap: 'anywhere' }}>
                                    {ACTION_LABELS[r.action] || r.action}
                                    {r.amountCents === null || r.amountCents === undefined ? '' : `, ${nad(r.amountCents)}`}
                                    {business ? `, ${business}` : ''}
                                    {r.reference ? ` (${r.reference})` : ''}
                                </p>
                                {r.reason && <p style={{ ...muted, overflowWrap: 'anywhere' }}>{r.reason}</p>}
                                <p style={{ ...muted, fontSize: '0.78rem' }}>
                                    {r.actor?.name || 'System'}{r.actorRole ? ` (${r.actorRole})` : ''}, {when(r.createdAt)}
                                    {r.approvalStatus && r.approvalStatus !== 'not_required' ? `, ${r.approvalStatus}` : ''}
                                </p>
                            </li>
                        );
                    })}
                </ul>
            )}
            {next && <button type="button" className="btn-outline" style={{ marginTop: '0.75rem' }} onClick={() => load(next)}>Show older</button>}
        </div>
    );
};

/* ───────────────────────── admins ───────────────────────── */

const Admins = ({ me, isDirector, onLocked }) => {
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [resetting, setResetting] = useState(null);
    const [reason, setReason] = useState('');
    const load = useCallback(async () => {
        try { setRows((await financeService.listAdmins()).data.data); } catch (err) {
            if (err?.response?.data?.code === 'mfa_required') onLocked();
            setRows([]);
        }
    }, [onLocked]);
    useEffect(() => { load(); }, [load]);
    const toggle = async (a, role) => {
        const roles = a.roles.includes(role) ? a.roles.filter((r) => r !== role) : [...a.roles, role];
        if (!roles.length) { toast('Keep at least one role. To take all money access away, remove the admin.', 'error'); return; }
        try { await financeService.setAdminRoles(a._id, roles); load(); } catch (err) { toast(apiError(err, 'Could not save.'), 'error'); }
    };
    const reset = async (a) => {
        try {
            await financeService.resetAdminMfa(a._id, reason.trim());
            toast(`${a.name} is signed out and sets up two-step sign-in again.`, 'success');
            setResetting(null); setReason('');
            load();
        } catch (err) { toast(apiError(err, 'Could not reset.'), 'error'); }
    };
    if (!rows) return <p style={muted}>Loading…</p>;
    return (
        <div style={card}>
            <h3 style={h3}>Who can do what</h3>
            <p style={{ ...muted, marginBottom: '0.75rem' }}>Finance sees payments and prepares refunds and adjustments. A director also approves them and changes prices and fees. Nobody approves their own request.</p>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
                {rows.map((a) => (
                    <div key={a._id} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.6rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <div style={{ minWidth: 0 }}>
                                <p style={{ fontWeight: 600, margin: 0 }}>{a.name}{String(a._id) === String(me) ? ' (you)' : ''}</p>
                                <p style={{ ...muted, fontSize: '0.8rem', wordBreak: 'break-all' }}>{a.email} · two-step sign-in {a.mfaEnabled ? 'on' : 'not set up'}</p>
                            </div>
                            <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                {['finance', 'director'].map((role) => (
                                    <label key={role} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.85rem', textTransform: 'capitalize' }}>
                                        <input type="checkbox" checked={a.roles.includes(role)} disabled={!isDirector} onChange={() => toggle(a, role)} style={{ accentColor: 'var(--charcoal)' }} /> {role}
                                    </label>
                                ))}
                                {isDirector && a.mfaEnabled && String(a._id) !== String(me) && resetting !== a._id && (
                                    <button type="button" className="btn-outline" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} onClick={() => { setResetting(a._id); setReason(''); }}>Reset two-step sign-in</button>
                                )}
                            </div>
                        </div>
                        {resetting === a._id && (
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (e.g. lost phone)" aria-label="Why" style={{ ...input, flex: '1 1 14rem' }} />
                                <button type="button" className="btn-primary" disabled={!reason.trim()} onClick={() => reset(a)}>Reset</button>
                                <button type="button" className="btn-outline" onClick={() => setResetting(null)}>Cancel</button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

/* ───────────────────────── the sections ───────────────────────── */

/** One Money or Settings section of the console (`view`). */
const MoneyPanel = ({ view = 'subscriptions' }) => {
    const { user } = useAuthContext();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    // An expired two-step session: the console's gate asks for the code again.
    const onLocked = useCallback(() => window.dispatchEvent(new CustomEvent(TWO_STEP_EVENT)), []);

    useEffect(() => {
        financeService.getSettings().then((r) => setData(r.data.data)).catch((err) => {
            const code = err?.response?.data?.code;
            if (code === 'mfa_required') onLocked();
            else if (code === 'finance_role_required') setError('This needs a money role (finance or director). A director can give you one under Admins and roles.');
            else setError(apiError(err, 'Could not load the settings.'));
        });
    }, [onLocked]);

    if (error) return <div role="alert" style={errBox}>{error}</div>;
    if (!data) return <p style={muted}>Loading…</p>;

    const isDirector = data.me?.roles?.includes('director');
    const me = user?._id || user?.id;
    return (
        // minmax(0, 1fr): a wide table scrolls inside its panel instead of
        // stretching the column past the phone's edge.
        <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(0, 1fr)' }} data-testid="money-panel">
            {view === 'prices' && <Settings data={data} isDirector={isDirector} onSaved={setData} onLocked={onLocked} />}
            {view === 'go-live' && (
                <>
                    <Launch launch={data.launch} isDirector={isDirector} onChanged={setData} onLocked={onLocked} />
                    <PaygateCheck onLocked={onLocked} />
                </>
            )}
            {view === 'admins' && <Admins me={me} isDirector={isDirector} onLocked={onLocked} />}
            {view === 'audit' && <Audit onLocked={onLocked} />}
            {view === 'subscriptions' && <SubscriptionsView isDirector={isDirector} onLocked={onLocked} />}
        </div>
    );
};

export default MoneyPanel;
