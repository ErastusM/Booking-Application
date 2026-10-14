import React, { useCallback, useEffect, useState } from 'react';
import { authService, financeService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { useToast } from './Toast';
import { PaymentsView, PayoutsView, DisputesView } from './MoneyOperations';
import { DashboardView, CostsView } from './FinanceDashboard';
import PaygateCheck from './PaygateCheck';

// The admin console's "Money" tab: Bookplus's own prices and fees, the pricing
// simulator, the launch checklist, second-person approvals, the financial
// audit log and who holds the money roles. Everything here needs two-step
// sign-in (an authenticator app), confirmed in this session within the last
// 12 hours; the API refuses otherwise (utils/financeRoles.requireFinance).

const nad = (cents) => {
    if (cents === null || cents === undefined) return '—';
    const neg = cents < 0;
    const s = (Math.abs(cents) / 100).toLocaleString('en-NA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${neg ? '-' : ''}N$${s}`;
};
const pct = (bps) => `${(bps / 100).toLocaleString('en-NA', { maximumFractionDigits: 2 })}%`;
const when = (d) => (d ? new Date(d).toLocaleString('en-NA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.25rem', boxShadow: 'var(--shadow-sm)', minWidth: 0 };
const h2 = { fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.35rem' };
const h3 = { fontFamily: 'var(--font-display)', fontSize: '0.98rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.75rem' };
const muted = { color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.55, margin: 0 };
const input = {
    width: '100%', padding: '0.6rem 0.75rem', border: '1.5px solid var(--border-input)', borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-body)', fontSize: '0.9rem', color: 'var(--text-primary)', background: 'white', boxSizing: 'border-box',
};
const label = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' };
const errBox = { background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' };
const th = { padding: '0.55rem 0.7rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const td = { padding: '0.55rem 0.7rem', fontSize: '0.85rem', borderTop: '1px solid var(--border)', whiteSpace: 'nowrap' };

const apiError = (err, fallback) => err?.response?.data?.message || fallback;

/* ───────────────────────── two-step sign-in ───────────────────────── */

const CodeInput = ({ value, onChange, id, placeholder = '123456' }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="one-time-code" inputMode="text"
        maxLength={14} placeholder={placeholder}
        style={{ ...input, letterSpacing: '0.25em', fontSize: '1.15rem', textAlign: 'center', padding: '0.75rem' }} />
);

// One numbered step of the set-up: number, title, then its content.
const Step = ({ n, title, children }) => (
    <section style={{ display: 'grid', gap: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
        <h3 style={{ ...h3, margin: 0, display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
            <span aria-hidden="true" style={{ color: 'var(--gold-dark)', fontVariantNumeric: 'tabular-nums' }}>{n}.</span>
            <span>{title}</span>
        </h3>
        {children}
    </section>
);
const fullButton = { width: '100%', justifyContent: 'center', textAlign: 'center' };

const MfaSetup = ({ onDone }) => {
    const { user, login } = useAuthContext();
    const [setup, setSetup] = useState(null);
    const [code, setCode] = useState('');
    const [codes, setCodes] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const start = async () => {
        setBusy(true); setError('');
        try { setSetup((await authService.mfaSetup()).data.data); } catch (err) { setError(apiError(err, 'Could not start the set-up.')); }
        setBusy(false);
    };
    const enable = async (e) => {
        e.preventDefault();
        setBusy(true); setError('');
        try {
            const d = (await authService.mfaEnable(code.trim())).data.data;
            login({ token: d.token, user });
            setCodes(d.recoveryCodes);
        } catch (err) { setError(apiError(err, 'That code was not accepted.')); }
        setBusy(false);
    };
    const download = () => {
        const blob = new Blob([`Bookplus recovery codes for ${user?.email || 'your account'}\nEach works once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'bookplus-recovery-codes.txt';
        a.click();
        URL.revokeObjectURL(a.href);
    };

    if (codes) {
        return (
            <div style={card} data-testid="mfa-recovery-codes">
                <h2 style={h2}>Two-step sign-in is on</h2>
                <p style={muted}>Save these recovery codes somewhere safe, away from your phone. Each one signs you in once if you lose your phone. They are not shown again.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))', gap: '0.5rem', margin: '1rem 0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.95rem' }}>
                    {codes.map((c) => <div key={c} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.45rem 0.6rem', textAlign: 'center' }}>{c}</div>)}
                </div>
                <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))' }}>
                    <button type="button" className="btn-outline" style={fullButton} onClick={download}>Download</button>
                    <button type="button" className="btn-primary" style={fullButton} onClick={onDone}>I saved them</button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ ...card, display: 'grid', gap: '1rem' }}>
            <div>
                <h2 style={h2}>Set up two-step sign-in</h2>
                <p style={muted}>Money controls need a code from an authenticator app (Google Authenticator, Microsoft Authenticator or similar) as well as your password. After this, signing in to this console asks for the code too.</p>
            </div>
            {error && <div role="alert" style={errBox}>{error}</div>}
            {!setup ? (
                <button type="button" className="btn-primary" style={fullButton} onClick={start} disabled={busy}>
                    {busy ? 'Starting…' : 'Start set-up'}
                </button>
            ) : (
                <form onSubmit={enable} style={{ display: 'grid', gap: '1rem' }}>
                    <Step n={1} title="Scan this code with your authenticator app">
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <img src={setup.qrDataUrl} alt="QR code to add Bookplus to your authenticator app" width={200} height={200}
                                style={{ display: 'block', width: '200px', height: '200px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'white' }} />
                        </div>
                        <p style={{ ...muted, textAlign: 'center' }}>Can't scan it? In the app, choose to enter a key and type:</p>
                        <code data-testid="mfa-secret" style={{
                            display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.2rem 0.55rem',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.95rem', letterSpacing: '0.04em',
                            background: 'var(--off-white)', padding: '0.7rem 0.75rem', borderRadius: 'var(--radius-sm)',
                        }}>
                            {setup.secret.match(/.{1,4}/g).map((g, i) => <span key={i} style={{ whiteSpace: 'nowrap' }}>{g}</span>)}
                        </code>
                    </Step>
                    <Step n={2} title="Enter the 6-digit code the app shows">
                        <label htmlFor="mfa-enable-code" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                            Enter the 6-digit code the app shows
                        </label>
                        <CodeInput id="mfa-enable-code" value={code} onChange={setCode} />
                        <button type="submit" className="btn-primary" style={fullButton} disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Turn on'}</button>
                    </Step>
                </form>
            )}
        </div>
    );
};

const MfaConfirm = ({ onDone }) => {
    const { user, login } = useAuthContext();
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        setBusy(true); setError('');
        try {
            const d = (await authService.mfaConfirm(code.trim())).data.data;
            login({ token: d.token, user });
            onDone();
        } catch (err) { setError(apiError(err, 'That code was not accepted.')); setBusy(false); }
    };
    return (
        <form onSubmit={submit} style={card}>
            <h2 style={h2}>Confirm it's you</h2>
            <p style={muted}>Enter the code from your authenticator app, or one of your recovery codes. It stays confirmed for 12 hours.</p>
            {error && <div role="alert" style={{ ...errBox, marginTop: '1rem' }}>{error}</div>}
            <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                <label style={{ ...label, marginBottom: 0 }} htmlFor="mfa-confirm-code">Code</label>
                <CodeInput id="mfa-confirm-code" value={code} onChange={setCode} />
                <button type="submit" className="btn-primary" style={fullButton} disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Confirm'}</button>
            </div>
        </form>
    );
};

/* ───────────────────────── prices and fees ───────────────────────── */

const WEEKDAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday']];
// [path, label, kind, options]. Kinds: money (cents), money? (cents or empty =
// not known yet), pct (basis points), pct? (bps or empty), int, num, text, bool, select.
const SECTIONS = [
    { title: 'Basic plan', items: [
        ['plans.basic.trialDays', 'Free trial (days)', 'int'],
        ['plans.basic.introMonths', 'Months at the introductory price', 'int'],
        ['plans.basic.introPriceCents', 'Introductory price a month', 'money'],
        ['plans.basic.priceCents', 'Price a month after that', 'money'],
        ['plans.basic.priceChangeNoticeDays', 'Notice before the price changes (days)', 'int'],
        ['plans.basic.commissionBps', 'Commission per online booking', 'pct'],
        ['plans.basic.fixedFeeCents', 'Fixed fee per online booking', 'money'],
    ] },
    { title: 'Standard plan', items: [
        ['plans.standard.priceCents', 'Price a month', 'money'],
        ['plans.standard.commissionBps', 'Commission per online booking', 'pct'],
        ['plans.standard.fixedFeeCents', 'Fixed fee per online booking', 'money'],
    ] },
    { title: 'Card processing (PayGate)', note: 'Leave empty until PayGate confirms Bookplus\'s actual Namibian fees.', items: [
        ['processingFee.bps', 'Processing fee, percentage', 'pct?'],
        ['processingFee.fixedCents', 'Processing fee, fixed part', 'money?'],
        ['processingFee.payer', 'Who bears it', 'select', [['business', 'The business'], ['bookplus', 'Bookplus']]],
        ['chargebackFeeCents', 'PayGate fee per chargeback', 'money?'],
    ] },
    { title: 'Safeguards', items: [
        ['minCommissionCents', 'Minimum commission per online booking', 'money'],
        ['minOnlineBookingCents', 'Smallest booking that can be paid online', 'money'],
        ['opsCostPerTxCents', 'Bookplus running cost per online booking', 'money'],
    ] },
    { title: 'Payouts', items: [
        ['payout.frequency', 'How often', 'select', [['weekly', 'Weekly'], ['biweekly', 'Every two weeks'], ['monthly', 'Monthly']]],
        ['payout.weekday', 'On', 'select', WEEKDAYS],
        ['payout.minThresholdCents', 'Smallest payout', 'money'],
    ] },
    { title: 'VAT', items: [
        ['vat.registered', 'Bookplus is VAT registered', 'bool'],
        ['vat.number', 'VAT number', 'text'],
        ['vat.ratePct', 'VAT rate (%)', 'num'],
    ] },
    { title: 'Approvals', items: [
        ['approvals.refundThresholdCents', 'Refunds above this need a director', 'money'],
        ['approvals.adjustmentsNeedApproval', 'Balance adjustments need a director', 'bool'],
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
    processingFeeEntered: 'PayGate\'s processing fee is entered',
    chargebackFeeEntered: 'PayGate\'s chargeback fee is entered',
    noNegativeMargin: 'No booking value in the simulator loses money',
    providerApproved: 'PayGate approved the payment structure in writing',
    pricingApproved: 'The owner approved the prices with the real fees',
    legalCleared: 'Legal clearance is on record',
    termsReviewed: 'A lawyer reviewed the new Terms and Privacy Policy',
    liveTestPassed: 'A live small payment and refund went through',
    payoutScheduleConfirmed: 'The owner confirmed the payout schedule',
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
                                            <input type="checkbox" checked={!!form[p]} onChange={(e) => setForm((f) => ({ ...f, [p]: e.target.checked }))} style={{ accentColor: 'var(--gold)' }} /> {l}
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
                        <input id="fin-reason" value={reason} onChange={(e) => setReason(e.target.value)} style={input} placeholder="e.g. PayGate's quote of 1 November" />
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button type="submit" className="btn-primary" disabled={busy || !changed.length || !reason.trim()}>
                            {busy ? 'Saving…' : `Save ${changed.length || ''} change${changed.length === 1 ? '' : 's'}`.replace('  ', ' ')}
                        </button>
                        <span style={muted}>Version {data.settings.version}. Businesses keep the rates they agreed until they are moved on purpose.</span>
                    </div>
                </div>
            )}
        </form>
    );
};

const Simulator = ({ sim }) => {
    const plans = [...new Set(sim.rows.map((r) => r.plan))];
    return (
        <div style={card}>
            <h3 style={h3}>Simulator</h3>
            <p style={{ ...muted, marginBottom: '0.75rem' }}>
                What each booking value earns with the settings above.
                {!sim.processingFeeKnown && ' The processing fee is not entered yet, so these leave it out.'}
            </p>
            {plans.map((plan) => (
                <div key={plan} style={{ marginBottom: '1rem' }}>
                    <p style={{ fontWeight: 600, fontSize: '0.88rem', margin: '0 0 0.35rem', textTransform: 'capitalize' }}>{plan}</p>
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr>
                                {['Customer pays', 'Bookplus net', 'Business gets', 'Commission', 'Fixed fee', 'Processing'].map((h) => <th key={h} style={th}>{h}</th>)}
                            </tr></thead>
                            <tbody>
                                {sim.rows.filter((r) => r.plan === plan).map((r) => (
                                    <tr key={r.bookingCents} style={{ opacity: r.belowMinimumBooking ? 0.55 : 1 }}>
                                        <td style={td}>{nad(r.customerPaysCents)}{r.belowMinimumBooking ? ' (not online)' : ''}</td>
                                        <td style={{ ...td, fontWeight: 600, color: r.negativeMargin ? '#991b1b' : 'var(--charcoal)' }}>{nad(r.bookplusNetCents)}</td>
                                        <td style={td}>{nad(r.businessPayoutCents)}</td>
                                        <td style={td}>{nad(r.percentCommissionCents)}{r.minCommissionApplied ? ' (min.)' : ''}</td>
                                        <td style={td}>{nad(r.fixedFeeCents)}</td>
                                        <td style={td}>{r.processingFeeKnown ? nad(r.processingFeeCents) : 'not entered'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}
            {sim.anyNegative && <div role="alert" style={errBox}>At least one booking value loses money. Raise the minimum commission or the smallest online booking before approving the prices.</div>}
        </div>
    );
};

const Launch = ({ launch, isDirector, onChanged, onLocked }) => {
    const toast = useToast();
    const [noteFor, setNoteFor] = useState(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const manual = new Set(['providerApproved', 'pricingApproved', 'legalCleared', 'termsReviewed', 'liveTestPassed', 'payoutScheduleConfirmed']);
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
            <h3 style={h3}>Before payments go live</h3>
            <p style={{ ...muted, marginBottom: '0.75rem' }}>
                {launch.ready ? 'Everything is in place. Switching payments on is still a server setting.' : 'Online payments stay off until every item is done.'}
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
                {launch.items.map((i) => (
                    <li key={i.key} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }} data-testid={`launch-${i.key}`}>
                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0, flex: '1 1 14rem' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.8rem', color: i.done ? '#166534' : 'var(--text-muted)', marginRight: '0.5rem' }}>{i.done ? 'Done' : 'To do'}</span>
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

/* ───────────────────────── businesses applying for online payments ───────────────────────── */

const APPLICATION_STATUS = {
    draft: 'Not sent', submitted: 'Waiting for review', info_requested: 'Asked for more', approved: 'Approved', rejected: 'Rejected',
};
const DOC_LABEL = { owner_id: 'Owner\'s ID or passport', registration: 'Company registration', bank_letter: 'Bank confirmation letter', other: 'Other document' };
const TYPE_LABEL = { sole_trader: 'Sole trader', cc: 'Close corporation (CC)', company: 'Company (Pty) Ltd', other: 'Other' };
const MISSING_LABEL = {
    plan: 'plan', businessType: 'kind of business', registeredName: 'registered name', registrationNumber: 'registration number',
    ownerName: 'owner\'s name', ownerIdNumber: 'ID number', doc_owner_id: 'ID document', doc_registration: 'registration document',
    doc_bank_letter: 'bank letter', payoutAccount: 'bank account',
};

const Row = ({ k, v }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(7rem, 38%) 1fr', gap: '0.5rem', fontSize: '0.86rem', padding: '0.3rem 0', borderTop: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--text-muted)' }}>{k}</span>
        <span style={{ overflowWrap: 'anywhere', color: 'var(--charcoal)' }}>{v || '—'}</span>
    </div>
);

const ApplicationReview = ({ id, onChanged, onLocked }) => {
    const toast = useToast();
    const [a, setA] = useState(null);
    const [note, setNote] = useState('');
    const [acting, setActing] = useState(null); // 'request_info' | 'reject' | 'switch' | 'bank'
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        try { setA((await financeService.getApproval(id)).data.data); } catch (err) {
            if (err?.response?.data?.code === 'mfa_required') onLocked();
            toast(apiError(err, 'Could not load the application.'), 'error');
        }
    }, [id, onLocked, toast]);
    useEffect(() => { load(); }, [load]);

    const openDoc = async (doc) => {
        // Open the tab first (inside the click) so the browser doesn't block
        // it, cut its link back to this page, then point it at the document.
        // ('noopener' would make window.open return null, losing the tab.)
        const tab = window.open('about:blank', '_blank');
        if (!tab) { toast('Allow pop-ups for this site to open documents.', 'error'); return; }
        tab.opener = null;
        try {
            const { url } = (await financeService.getApprovalDocument(id, doc._id)).data.data;
            tab.location.href = url;
        } catch (err) {
            if (tab) tab.close();
            toast(apiError(err, 'Could not open the document.'), 'error');
        }
    };
    const act = async (fn, ok) => {
        setBusy(true);
        try {
            await fn();
            toast(ok, 'success');
            setActing(null); setNote('');
            await load();
            onChanged();
        } catch (err) {
            if (err?.response?.data?.code === 'mfa_required') onLocked();
            toast(apiError(err, 'That did not work.'), 'error');
        }
        setBusy(false);
    };

    if (!a) return <p style={muted}>Loading…</p>;
    const app = a.application;
    const acct = a.payoutAccount || {};
    const noteBox = (placeholder, button, onGo) => (
        <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={placeholder} aria-label={placeholder}
                style={{ ...input, resize: 'vertical', fontFamily: 'var(--font-body)' }} />
            <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: '1fr 1fr' }}>
                <button type="button" className="btn-outline" style={{ width: '100%' }} onClick={() => { setActing(null); setNote(''); }}>Cancel</button>
                <button type="button" className="btn-primary" style={{ width: '100%' }} disabled={busy || !note.trim()} onClick={onGo}>{button}</button>
            </div>
        </div>
    );
    return (
        <div style={{ display: 'grid', gap: '0.9rem', marginTop: '0.75rem', gridTemplateColumns: 'minmax(0, 1fr)', overflowWrap: 'anywhere' }} data-testid="application-review">
            <div>
                <p style={{ ...h3, marginBottom: '0.25rem' }}>Business</p>
                <Row k="Business" v={a.businessName} />
                <Row k="Account" v={`${a.name}, ${a.email}${a.phone ? `, ${a.phone}` : ''}`} />
                <Row k="Address" v={a.address} />
                <Row k="On Bookplus since" v={a.accountCreatedAt ? new Date(a.accountCreatedAt).toLocaleDateString('en-NA') : ''} />
                <Row k="Plan chosen" v={app.plan ? app.plan[0].toUpperCase() + app.plan.slice(1) : ''} />
            </div>
            <div>
                <p style={{ ...h3, marginBottom: '0.25rem' }}>Legal details</p>
                <Row k="Kind" v={TYPE_LABEL[app.legal.businessType]} />
                <Row k="Registered name" v={app.legal.registeredName} />
                {app.legal.businessType !== 'sole_trader' && <Row k="Registration number" v={app.legal.registrationNumber} />}
                <Row k="Owner" v={app.legal.ownerName} />
                <Row k="ID or passport" v={app.legal.ownerIdNumber} />
            </div>
            <div>
                <p style={{ ...h3, marginBottom: '0.25rem' }}>Bank account for payouts</p>
                <Row k="Holder" v={acct.accountHolder} />
                <Row k="Bank" v={acct.bankName} />
                <Row k="Branch code" v={acct.branchCode} />
                <Row k="Account number" v={acct.accountNumber} />
                {a.payoutAccountReviewNeeded && <p style={{ ...muted, color: '#991b1b', marginTop: '0.35rem' }}>Changed after approval: payouts are held until it is checked.</p>}
            </div>
            <div>
                <p style={{ ...h3, marginBottom: '0.4rem' }}>Documents</p>
                {app.documents.length ? (
                    <div style={{ display: 'grid', gap: '0.4rem' }}>
                        {app.documents.map((doc) => (
                            <div key={doc._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                                <span style={{ fontSize: '0.86rem', minWidth: 0, overflowWrap: 'anywhere' }}>{DOC_LABEL[doc.kind] || doc.kind}{doc.name ? ` (${doc.name})` : ''}</span>
                                <button type="button" className="btn-outline" style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem', flexShrink: 0 }} onClick={() => openDoc(doc)}>Open</button>
                            </div>
                        ))}
                        <p style={{ ...muted, fontSize: '0.78rem' }}>Each link works for 5 minutes. Opening one is recorded in the audit log.</p>
                    </div>
                ) : <p style={muted}>None (deleted when an application is rejected).</p>}
            </div>
            {a.missing?.length > 0 && <p style={{ ...muted, color: '#991b1b' }}>Missing: {a.missing.map((m) => MISSING_LABEL[m] || m).join(', ')}</p>}

            {a.status === 'submitted' && (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {!acting && (
                        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 8rem), 1fr))' }}>
                            <button type="button" className="btn-primary" style={{ width: '100%' }} disabled={busy || a.missing?.length > 0}
                                onClick={() => act(() => financeService.decideApproval(id, 'approve'), 'Approved')}>Approve</button>
                            <button type="button" className="btn-outline" style={{ width: '100%' }} onClick={() => setActing('request_info')}>Ask for more</button>
                            <button type="button" className="btn-outline" style={{ width: '100%' }} onClick={() => setActing('reject')}>Reject</button>
                        </div>
                    )}
                    {acting === 'request_info' && noteBox('What else is needed (the business sees this)', 'Send', () => act(() => financeService.decideApproval(id, 'request_info', note.trim()), 'Sent to the business'))}
                    {acting === 'reject' && (
                        <>
                            <p style={{ ...muted, color: '#991b1b' }}>Rejecting deletes the documents the business sent.</p>
                            {noteBox('Why it is rejected (the business sees this)', 'Reject', () => act(() => financeService.decideApproval(id, 'reject', note.trim()), 'Rejected'))}
                        </>
                    )}
                </div>
            )}
            {a.status === 'approved' && (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                    <p style={muted}>{a.adminOff ? 'Switched off by Bookplus.' : a.takingPayments ? 'Taking online payments.' : 'Approved; the business has not switched online payments on.'}</p>
                    {!acting && (
                        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11rem), 1fr))' }}>
                            <button type="button" className="btn-outline" style={{ width: '100%' }} onClick={() => setActing('switch')}>{a.adminOff ? 'Allow online payments again' : 'Switch online payments off'}</button>
                            {a.payoutAccountReviewNeeded && <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => setActing('bank')}>New bank account checked</button>}
                        </div>
                    )}
                    {acting === 'switch' && noteBox('Why (recorded, and shown to the business when switched off)', a.adminOff ? 'Allow again' : 'Switch off',
                        () => act(() => financeService.setApprovalSwitch(id, !a.adminOff, note.trim()), a.adminOff ? 'Allowed again' : 'Switched off'))}
                    {acting === 'bank' && noteBox('How it was checked (e.g. new bank letter, called the owner)', 'Confirm',
                        () => act(() => financeService.confirmPayoutAccount(id, note.trim(), acct.updatedAt), 'Bank account confirmed'))}
                </div>
            )}
            {app.history?.length > 0 && (
                <details>
                    <summary style={{ cursor: 'pointer', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>History</summary>
                    <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                        {app.history.map((h, i) => <li key={i}>{when(h.at)}: {APPLICATION_STATUS[h.status] || h.status.replace(/_/g, ' ')}{h.note ? `, ${h.note}` : ''}</li>)}
                    </ul>
                </details>
            )}
        </div>
    );
};

const BusinessApprovals = ({ onLocked }) => {
    const [filter, setFilter] = useState('waiting');
    const [rows, setRows] = useState(null);
    const [open, setOpen] = useState(null);
    const load = useCallback(async () => {
        try { setRows((await financeService.listApprovals(filter)).data.data); } catch (err) {
            if (err?.response?.data?.code === 'mfa_required') onLocked();
            setRows([]);
        }
    }, [filter, onLocked]);
    useEffect(() => { setRows(null); load(); }, [load]);
    return (
        <div style={card} data-testid="business-approvals">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <h3 style={{ ...h3, margin: 0 }}>Businesses applying for online payments</h3>
                <select value={filter} onChange={(e) => { setFilter(e.target.value); setOpen(null); }} aria-label="Show" style={{ ...input, width: 'auto' }}>
                    <option value="waiting">Waiting for Bookplus</option>
                    <option value="info_requested">Asked for more</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                </select>
            </div>
            {!rows ? <p style={muted}>Loading…</p> : !rows.length ? <p style={muted}>None.</p> : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {rows.map((r) => (
                        <li key={r._id} style={{ borderTop: '1px solid var(--border)', padding: '0.7rem 0' }} data-testid="approval-row">
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                                <div style={{ minWidth: 0 }}>
                                    <p style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{r.businessName || r.name}</p>
                                    <p style={{ ...muted, fontSize: '0.8rem' }}>
                                        {APPLICATION_STATUS[r.status] || r.status}{r.plan ? `, ${r.plan}` : ''}{r.submittedAt ? `, sent ${when(r.submittedAt)}` : ''}
                                        {r.payoutAccountReviewNeeded ? ', new bank account to check' : ''}
                                    </p>
                                </div>
                                <button type="button" className={open === r._id ? 'btn-primary' : 'btn-outline'} style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem', flexShrink: 0 }}
                                    onClick={() => setOpen(open === r._id ? null : r._id)} aria-expanded={open === r._id}>
                                    {open === r._id ? 'Close' : 'Review'}
                                </button>
                            </div>
                            {open === r._id && <ApplicationReview id={r._id} onChanged={load} onLocked={onLocked} />}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

/* ───────────────────────── approvals ───────────────────────── */

const Approvals = ({ me, isDirector, onLocked }) => {
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [rejecting, setRejecting] = useState(null);
    const [note, setNote] = useState('');
    const load = useCallback(async () => {
        try { setRows((await financeService.listRequests()).data.data); } catch (err) {
            if (err?.response?.data?.code === 'mfa_required') onLocked();
            setRows([]);
        }
    }, [onLocked]);
    useEffect(() => { load(); }, [load]);
    const decide = async (r, approve) => {
        try {
            const res = approve ? await financeService.approveRequest(r._id) : await financeService.rejectRequest(r._id, note.trim());
            toast(approve ? (res.data.data.status === 'executed' ? 'Approved and carried out' : 'Approved; it did not go through yet') : 'Rejected', approve && res.data.data.status !== 'executed' ? 'error' : 'success');
            setRejecting(null); setNote('');
            load();
        } catch (err) { toast(apiError(err, 'Could not save.'), 'error'); }
    };
    if (!rows) return <p style={muted}>Loading…</p>;
    if (!rows.length) return <div style={card}><p style={muted}>Nothing waiting. Refunds above the approval limit, refunds a business asks Bookplus for, and balance adjustments show up here.</p></div>;
    return (
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'minmax(0, 1fr)' }}>
            {rows.map((r) => {
                const mine = String(r.preparedBy?._id || r.preparedBy) === String(me);
                const business = r.provider?.businessProfile?.businessName || r.provider?.name || '';
                return (
                    <div key={r._id} style={card} data-testid="finance-request">
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0 }}>
                                <p style={{ fontWeight: 600, margin: 0 }}>{r.type === 'refund' ? 'Refund' : r.type === 'recovery' ? 'Recover a lost chargeback' : 'Balance adjustment'} of {nad(r.amountCents)}{business ? `, ${business}` : ''}</p>
                                <p style={{ ...muted, overflowWrap: 'anywhere' }}>{r.reason}</p>
                                <p style={{ ...muted, fontSize: '0.78rem' }}>
                                    {r.requestedByBusiness ? `Asked by the business (${r.preparedBy?.name || 'the owner'}), more than it may refund on its own` : `Prepared by ${r.preparedBy?.name || 'someone'}`}, {when(r.createdAt)}
                                </p>
                                {r.requestedByBusiness && r.balanceNowCents !== null && r.balanceNowCents !== undefined && (
                                    <p style={{ ...muted, fontSize: '0.78rem', color: r.amountCents > r.balanceNowCents ? '#92400e' : undefined }} data-testid="request-balance">
                                        The business holds {nad(Math.max(0, r.balanceNowCents))} now.
                                        {r.amountCents > r.balanceNowCents && ` Approving means Bookplus pays ${nad(r.amountCents - Math.max(0, r.balanceNowCents))} of it until the business earns it back.`}
                                    </p>
                                )}
                                {r.status !== 'pending' && <p style={{ ...muted, fontSize: '0.78rem' }}>{r.status[0].toUpperCase() + r.status.slice(1)}{r.decidedBy?.name ? ` by ${r.decidedBy.name}` : ''}{r.decisionNote ? `: ${r.decisionNote}` : ''}</p>}
                            </div>
                            {r.status === 'pending' && isDirector && !mine && rejecting !== r._id && (
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                                    <button type="button" className="btn-primary" onClick={() => decide(r, true)}>Approve</button>
                                    <button type="button" className="btn-outline" onClick={() => { setRejecting(r._id); setNote(''); }}>Reject</button>
                                </div>
                            )}
                            {r.status === 'pending' && (mine || !isDirector) && <span style={{ ...muted, fontSize: '0.8rem' }}>Waiting for {mine ? 'another' : 'a'} director</span>}
                        </div>
                        {rejecting === r._id && (
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it is rejected" aria-label="Why it is rejected" style={{ ...input, flex: '1 1 14rem' }} />
                                <button type="button" className="btn-primary" disabled={!note.trim()} onClick={() => decide(r, false)}>Reject</button>
                                <button type="button" className="btn-outline" onClick={() => setRejecting(null)}>Cancel</button>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

/* ───────────────────────── audit log ───────────────────────── */

const ACTION_LABELS = {
    'settings.update': 'Changed prices and fees', 'launch.confirm': 'Confirmed a launch item', 'launch.unconfirm': 'Undid a launch item',
    'business.pricing': 'Changed a business\'s plan', 'refund.request': 'Asked for a refund', 'refund.approve': 'Approved a refund',
    'refund.reject': 'Rejected a refund', 'refund.execute': 'Refunded', 'refund.fail': 'Refund did not go through', 'refund.owner': 'Business refunded',
    'adjustment.request': 'Asked for an adjustment', 'adjustment.approve': 'Approved an adjustment', 'adjustment.reject': 'Rejected an adjustment',
    'adjustment.execute': 'Adjusted a balance', 'adjustment.fail': 'Adjustment failed', 'payout.record': 'Recorded a payout',
    'roles.update': 'Changed money roles', 'security.mfa_enabled': 'Turned on two-step sign-in', 'security.mfa_reset': 'Reset two-step sign-in',
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
                                        <input type="checkbox" checked={a.roles.includes(role)} disabled={!isDirector} onChange={() => toggle(a, role)} style={{ accentColor: 'var(--gold)' }} /> {role}
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

/* ───────────────────────── the panel ───────────────────────── */

// Eight, so they sit in an even grid: 2 × 4 on a phone, 4 × 2 wider.
const VIEWS = [
    ['dashboard', 'Dashboard'], ['payments', 'Payments'], ['payouts', 'Payouts'], ['disputes', 'Disputes'],
    ['approvals', 'Approvals'], ['costs', 'Costs'], ['audit', 'Audit log'], ['prices', 'Settings'],
];

const MoneyPanel = () => {
    const { user } = useAuthContext();
    const [status, setStatus] = useState(null);
    const [data, setData] = useState(null);
    const [view, setView] = useState('dashboard');
    const [caseId, setCaseId] = useState(null);
    const [error, setError] = useState('');

    const loadStatus = useCallback(async () => {
        try { setStatus((await authService.mfaStatus()).data.data); } catch (err) { setError(apiError(err, 'Could not load.')); }
    }, []);
    const onLocked = useCallback(() => setStatus((s) => (s ? { ...s, sessionConfirmed: false } : s)), []);
    useEffect(() => { loadStatus(); }, [loadStatus]);

    const confirmed = status?.enabled && status?.sessionConfirmed;
    useEffect(() => {
        if (!confirmed) return;
        financeService.getSettings().then((r) => setData(r.data.data)).catch((err) => {
            if (err?.response?.data?.code === 'mfa_required') onLocked();
            else setError(apiError(err, 'Could not load the settings.'));
        });
    }, [confirmed, onLocked]);

    if (error) return <div role="alert" style={errBox}>{error}</div>;
    if (!status) return <p style={muted}>Loading…</p>;
    if (!status.enabled) return <MfaSetup onDone={loadStatus} />;
    if (!status.sessionConfirmed) return <MfaConfirm onDone={loadStatus} />;
    if (!data) return <p style={muted}>Loading…</p>;

    const isDirector = data.me?.roles?.includes('director');
    const me = user?._id || user?.id;
    return (
        // minmax(0, 1fr): a wide table scrolls inside its card instead of
        // stretching the column past the phone's edge.
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(0, 1fr)' }} data-testid="money-panel">
            <style>{'.money-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); } @media (min-width: 640px) { .money-tabs { grid-template-columns: repeat(4, minmax(0, 1fr)); } }'}</style>
            <div className="money-tabs" style={{ display: 'grid', gap: '0.5rem' }} role="tablist" aria-label="Money sections">
                {VIEWS.map(([key, text]) => (
                    <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
                        className={view === key ? 'btn-primary' : 'btn-outline'} style={{ ...fullButton, fontSize: '0.85rem', padding: '0.55rem 0.5rem' }}>
                        {text}
                    </button>
                ))}
            </div>
            <p style={{ ...muted, fontSize: '0.8rem' }}>
                Your roles: {(data.me?.roles || []).join(' and ') || 'none'}. Online payments are off until everything in "Before payments go live" is done.
                {status.recoveryCodesLeft <= 2 && ` You have ${status.recoveryCodesLeft} recovery code${status.recoveryCodesLeft === 1 ? '' : 's'} left.`}
            </p>
            {view === 'prices' && (
                <>
                    <Launch launch={data.launch} isDirector={isDirector} onChanged={setData} onLocked={onLocked} />
                    <PaygateCheck onLocked={onLocked} />
                    <Simulator sim={data.simulator} />
                    <Settings data={data} isDirector={isDirector} onSaved={setData} onLocked={onLocked} />
                    <h3 style={{ ...h3, margin: '0.25rem 0 0' }}>Admins and money roles</h3>
                    <Admins me={me} isDirector={isDirector} onLocked={onLocked} />
                </>
            )}
            {view === 'approvals' && (
                <>
                    <BusinessApprovals onLocked={onLocked} />
                    <h3 style={{ ...h3, margin: '0.25rem 0 0' }}>Refunds and adjustments</h3>
                    <Approvals me={me} isDirector={isDirector} onLocked={onLocked} />
                </>
            )}
            {view === 'dashboard' && <DashboardView launch={data.launch} onLocked={onLocked} onOpenSettings={() => setView('prices')} />}
            {view === 'costs' && <CostsView isDirector={isDirector} onLocked={onLocked} />}
            {view === 'payments' && <PaymentsView onLocked={onLocked} onCaseOpened={(id) => { setCaseId(id); setView('disputes'); }} />}
            {view === 'payouts' && <PayoutsView onLocked={onLocked} />}
            {view === 'disputes' && <DisputesView onLocked={onLocked} openId={caseId} />}
            {view === 'audit' && <Audit onLocked={onLocked} />}
        </div>
    );
};

export default MoneyPanel;
