import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onlinePaymentsService } from '../services';
import { useToast } from './Toast';
import { uploadVerificationDocument, VERIFICATION_ACCEPT } from '../utils/uploadImage';
import PaymentsMoney from './PaymentsMoney';

// Account → Online payments (owner only). A business applies to take card
// payments through Bookplus: it chooses a plan with every cost shown, gives its
// legal details, uploads its documents privately, adds the bank account
// Bookplus pays it into, accepts the terms and sends it. Bookplus reviews it;
// once approved, the business switches online payments on or off here.

const nad = (cents) => `N$${(Math.max(0, cents || 0) / 100).toLocaleString('en-NA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bps) => `${((bps || 0) / 100).toLocaleString('en-NA', { maximumFractionDigits: 2 })}%`;
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const apiError = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

const card = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem', minWidth: 0 };
const h2 = { fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.35rem' };
const h3 = { fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--charcoal)', margin: 0 };
const muted = { color: 'var(--text-muted)', fontSize: '0.86rem', lineHeight: 1.55, margin: 0 };
const label = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' };
const input = {
    width: '100%', padding: '0.65rem 0.8rem', border: '1.5px solid var(--border-input)', borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-body)', fontSize: '0.92rem', color: 'var(--text-primary)', background: 'white', boxSizing: 'border-box',
};
const errBox = { background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.86rem' };
const full = { width: '100%', justifyContent: 'center', textAlign: 'center' };
const stack = { display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(0, 1fr)' };

const MISSING_TEXT = {
    plan: 'Choose a plan',
    businessType: 'Say what kind of business it is',
    registeredName: 'Registered business name',
    registrationNumber: 'Registration number',
    ownerName: 'Owner\'s full name',
    ownerIdNumber: 'Owner\'s ID or passport number',
    doc_owner_id: 'Upload the owner\'s ID',
    doc_registration: 'Upload the company registration',
    doc_bank_letter: 'Upload the bank confirmation letter',
    payoutAccount: 'Add the bank account for payouts',
};
const BUSINESS_TYPES = [
    ['sole_trader', 'Sole trader (just me, not registered as a company)'],
    ['cc', 'Close corporation (CC)'],
    ['company', 'Company (Pty) Ltd'],
    ['other', 'Something else'],
];
const DOCS = [
    ['owner_id', 'Owner\'s ID or passport', 'A clear copy of the front (and back of an ID card).'],
    ['registration', 'Company registration', 'The registration certificate (CC or company).'],
    ['bank_letter', 'Bank confirmation letter', 'From your bank, in the business\'s name, not older than 3 months.'],
];

const STATUS_TEXT = {
    draft: ['Not sent yet', 'Fill in each part below, then send it to Bookplus.'],
    submitted: ['With Bookplus', 'Bookplus is checking your application. You get a notification when it is decided.'],
    info_requested: ['Bookplus needs a little more', ''],
    approved: ['Approved', ''],
    rejected: ['Not approved', ''],
};

// What the business receives from one online booking of `cents` on a plan.
const exampleFor = (plan, processingFee, cents, minCommissionCents = 0) => {
    const commission = Math.min(cents, Math.max(minCommissionCents, Math.round((cents * plan.commissionBps) / 10000) + (plan.fixedFeeCents || 0)));
    const processing = processingFee.known && processingFee.payer === 'business'
        ? Math.round((cents * (processingFee.bps || 0)) / 10000) + (processingFee.fixedCents || 0)
        : 0;
    return { commission, processing, receive: cents - commission - processing };
};

const PlanCard = ({ plan, processingFee, minCommissionCents = 0, selected, disabled, onChoose }) => {
    const parts = [
        plan.trialDays ? `free for ${plan.trialDays} days` : null,
        plan.introMonths ? `${nad(plan.introPriceCents)} a month for ${plan.introMonths} months` : null,
        `${nad(plan.priceCents)} a month`,
    ].filter(Boolean).map((p, i) => (i === 0 ? p : `then ${p}`)).join(', ');
    const monthly = plan.priceCents === 0 && plan.introPriceCents === 0 ? 'No monthly fee' : parts[0].toUpperCase() + parts.slice(1);
    const perBooking = `${plan.fixedFeeCents ? `${pct(plan.commissionBps)} + ${nad(plan.fixedFeeCents)}` : pct(plan.commissionBps)}${minCommissionCents ? `, at least ${nad(minCommissionCents)}` : ''}`;
    const ex = exampleFor(plan, processingFee, 20000, minCommissionCents);
    return (
        <label data-testid={`plan-${plan.key}`} style={{
            ...card, display: 'grid', gap: '0.5rem', cursor: disabled ? 'default' : 'pointer',
            borderColor: selected ? 'var(--gold)' : 'var(--border)', boxShadow: selected ? '0 0 0 1px var(--gold)' : card.boxShadow,
        }}>
            <span style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <input type="radio" name="plan" checked={selected} disabled={disabled} onChange={() => onChoose(plan.key)} style={{ accentColor: 'var(--gold)' }} />
                <span style={h3}>{plan.label}</span>
            </span>
            <span style={{ fontSize: '0.9rem', color: 'var(--charcoal)' }}>{monthly}</span>
            <span style={muted}>Bookplus fee on each online booking: <strong style={{ color: 'var(--charcoal)' }}>{perBooking}</strong></span>
            <span style={{ ...muted, fontSize: '0.8rem' }}>
                On a N$200.00 booking you receive {nad(ex.receive)}{processingFee.known ? '' : ', before the card processing fee'}.
            </span>
        </label>
    );
};

// What a client pays online when booking: nothing (at the appointment), a
// deposit (percent of the price or a fixed amount), or the full price.
const describeMode = (m) => {
    if (!m || m.mode === 'at_appointment') return null;
    if (m.mode === 'full') return 'the full price';
    return m.depositType === 'fixed' ? `a deposit of ${nad(m.depositValue)}` : `a deposit of ${m.depositValue}% of the price`;
};

const PaymentMode = ({ value, onSaved }) => {
    const toast = useToast();
    const [mode, setMode] = useState(value?.mode || 'at_appointment');
    const [depositType, setDepositType] = useState(value?.depositType || 'percent');
    const [amount, setAmount] = useState(() => {
        if (value?.mode !== 'deposit' || value?.depositValue == null) return '';
        return value.depositType === 'fixed' ? (value.depositValue / 100).toFixed(2) : String(value.depositValue);
    });
    const [busy, setBusy] = useState(false);
    const save = async (e) => {
        e.preventDefault();
        const body = { mode };
        if (mode === 'deposit') {
            const n = Number(String(amount).replace(',', '.'));
            if (!Number.isFinite(n) || n <= 0) { toast('Enter the deposit', 'error'); return; }
            body.depositType = depositType;
            body.depositValue = depositType === 'fixed' ? Math.round(n * 100) : Math.round(n);
        }
        setBusy(true);
        try {
            const res = await onlinePaymentsService.updateSettings(body);
            onSaved(res.data.data);
            toast('Saved', 'success');
        } catch (err) { toast(apiError(err, 'Could not save.'), 'error'); }
        setBusy(false);
    };
    const options = [
        ['at_appointment', 'Nothing online', 'Clients pay at the appointment.'],
        ['deposit', 'A deposit when they book', 'The rest is paid at the appointment.'],
        ['full', 'The full price when they book', ''],
    ];
    return (
        <form onSubmit={save} style={{ ...stack, borderTop: '1px solid var(--border)', paddingTop: '0.9rem', marginTop: '0.9rem' }} data-testid="payment-mode">
            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.92rem' }}>What clients pay online</p>
            <div role="radiogroup" aria-label="What clients pay online" style={{ display: 'grid', gap: '0.5rem' }}>
                {options.map(([v, title, hint]) => (
                    <label key={v} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.9rem' }}>
                        <input type="radio" name="pay-mode" value={v} checked={mode === v} onChange={() => setMode(v)} style={{ accentColor: 'var(--gold)', marginTop: '0.2rem' }} />
                        <span>{title}{hint && <span style={{ ...muted, display: 'block', fontSize: '0.8rem' }}>{hint}</span>}</span>
                    </label>
                ))}
            </div>
            {mode === 'deposit' && (
                <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                    <div>
                        <label style={label} htmlFor="dep-type">Deposit as</label>
                        <select id="dep-type" value={depositType} onChange={(e) => setDepositType(e.target.value)} style={input}>
                            <option value="percent">A percentage</option>
                            <option value="fixed">A fixed amount</option>
                        </select>
                    </div>
                    <div>
                        <label style={label} htmlFor="dep-value">{depositType === 'fixed' ? 'Amount (N$)' : 'Percent of the price'}</label>
                        <input id="dep-value" value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} style={input} placeholder={depositType === 'fixed' ? '50.00' : '25'} />
                    </div>
                </div>
            )}
            <button type="submit" className="btn-primary" style={full} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </form>
    );
};

const OnlinePaymentsSection = () => {
    const toast = useToast();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [legal, setLegal] = useState(null);
    const [bank, setBank] = useState({ accountHolder: '', bankName: '', branchCode: '', accountNumber: '' });
    const [bankEditing, setBankEditing] = useState(false);
    const [bankView, setBankView] = useState(null);
    const [busy, setBusy] = useState('');
    const [terms, setTerms] = useState(false);
    const [payMode, setPayMode] = useState(null);
    const fileRefs = useRef({});

    // resetForm: put the server's details into the form. Only on first load
    // and after saving them, so another save (an upload, the plan) never
    // wipes details typed but not saved yet.
    const apply = useCallback((data, { resetForm = false } = {}) => {
        setD(data);
        if (!resetForm) return;
        setLegal({
            businessType: data.legal.businessType || '',
            registeredName: data.legal.registeredName || '',
            registrationNumber: data.legal.registrationNumber || '',
            ownerName: data.legal.ownerName || '',
            ownerIdNumber: '',
        });
    }, []);

    const load = useCallback(async () => {
        try {
            apply((await onlinePaymentsService.getApplication()).data.data, { resetForm: true });
            const acct = (await onlinePaymentsService.getPayoutAccount()).data.data;
            setBankView(acct);
        } catch (err) { setError(apiError(err, 'Could not load your online payments.')); }
    }, [apply]);
    useEffect(() => { load(); }, [load]);
    const approved = d?.status === 'approved';
    useEffect(() => {
        if (!approved) return;
        onlinePaymentsService.getSettings().then((r) => setPayMode(r.data.data)).catch(() => setPayMode({ mode: 'at_appointment' }));
    }, [approved]);

    const run = async (key, fn, okMessage) => {
        setBusy(key);
        try {
            const res = await fn();
            if (res?.data?.data && res.data.data.status) apply(res.data.data);
            if (okMessage) toast(okMessage, 'success');
            return res;
        } catch (err) {
            toast(apiError(err, 'That did not work. Please try again.'), 'error');
            return null;
        } finally { setBusy(''); }
    };

    if (error) return <div role="alert" style={errBox}>{error}</div>;
    if (!d || !legal) return <p style={muted}>Loading…</p>;

    const editable = d.editable;
    const [statusTitle, statusText] = STATUS_TEXT[d.status] || STATUS_TEXT.draft;
    const docs = DOCS.filter(([kind]) => kind !== 'registration' || legal.businessType !== 'sole_trader');

    const flipSwitch = async (on) => {
        setD((x) => ({ ...x, switchOn: on }));
        const res = await run('switch', () => onlinePaymentsService.setSwitch(on), on ? 'Online payments are on' : 'Online payments are off');
        if (!res) setD((x) => ({ ...x, switchOn: !on }));
    };

    // Shown as chosen at once; put back if saving fails.
    const choosePlan = async (key) => {
        const before = d.plan;
        setD((x) => ({ ...x, plan: key }));
        const res = await run('plan', () => onlinePaymentsService.updateApplication({ plan: key }));
        if (!res) setD((x) => ({ ...x, plan: before }));
    };

    const saveDetails = (e) => {
        e.preventDefault();
        const payload = { ...legal };
        if (!payload.ownerIdNumber) delete payload.ownerIdNumber; // keep the one already given
        if (!payload.businessType) delete payload.businessType;
        return run('details', () => onlinePaymentsService.updateApplication({ legal: payload }), 'Details saved')
            .then((res) => { if (res?.data?.data) apply(res.data.data, { resetForm: true }); });
    };

    const upload = async (kind, file) => {
        if (!file) return;
        setBusy(`doc-${kind}`);
        try {
            const { ref } = await uploadVerificationDocument(file);
            const res = await onlinePaymentsService.addDocument({ kind, name: file.name, ref });
            apply(res.data.data);
            toast('Uploaded', 'success');
        } catch (err) {
            toast(apiError(err, 'Could not upload that file. Please try again.'), 'error');
        } finally {
            setBusy('');
            if (fileRefs.current[kind]) fileRefs.current[kind].value = '';
        }
    };

    const saveBank = async (e) => {
        e.preventDefault();
        const res = await run('bank', () => onlinePaymentsService.updatePayoutAccount(bank));
        if (res) {
            setBankView(res.data.data);
            setBankEditing(false);
            toast(res.data.message || 'Bank account saved', 'success');
            apply((await onlinePaymentsService.getApplication()).data.data);
        }
    };
    const editBank = async () => {
        try {
            const acct = (await onlinePaymentsService.getPayoutAccountForEdit()).data.data;
            setBank({ accountHolder: acct.accountHolder || '', bankName: acct.bankName || '', branchCode: acct.branchCode || '', accountNumber: acct.accountNumber || '' });
        } catch { /* start empty */ }
        setBankEditing(true);
    };

    return (
        <div style={stack} data-testid="online-payments">
            <div style={card}>
                <h2 style={h2}>Online payments</h2>
                <p style={muted}>Let clients pay a deposit or the full price when they book. Bookplus collects the payment and pays it into your bank account{d.payout ? `, ${d.payout.frequency === 'weekly' ? `every ${WEEKDAY[d.payout.weekday]}` : d.payout.frequency === 'biweekly' ? 'every two weeks' : 'monthly'}` : ''}, less the fees below.</p>
                <div data-testid="application-status" style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.85rem' }}>
                    <p style={{ margin: 0, fontWeight: 600, color: d.status === 'approved' ? '#166534' : d.status === 'rejected' ? '#991b1b' : 'var(--charcoal)' }}>{statusTitle}</p>
                    {statusText && <p style={muted}>{statusText}</p>}
                    {d.decisionNote && ['info_requested', 'rejected'].includes(d.status) && <p style={{ ...muted, color: 'var(--charcoal)', overflowWrap: 'anywhere' }}>Bookplus: {d.decisionNote}</p>}
                    {d.status === 'rejected' && <p style={muted}>The documents you sent were deleted. You can change your details and apply again.</p>}
                </div>
            </div>

            {d.status === 'approved' && (
                <div style={card} data-testid="payments-switch">
                    <h3 style={{ ...h3, marginBottom: '0.5rem' }}>Take payments online</h3>
                    {d.adminOff ? (
                        <p style={{ ...muted, color: '#991b1b' }}>Bookplus has switched online payments off for your business{d.adminOffReason ? `: ${d.adminOffReason}` : ''}. Contact Bookplus.</p>
                    ) : (
                        <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '0.92rem' }}>
                            <input type="checkbox" checked={d.switchOn} disabled={busy === 'switch'} onChange={(e) => flipSwitch(e.target.checked)} style={{ accentColor: 'var(--gold)' }} />
                            <span data-testid="switch-label">
                                {!d.switchOn
                                    ? 'Off: clients pay at the appointment'
                                    : describeMode(payMode)
                                        ? `On: clients pay ${describeMode(payMode)} when they book`
                                        : 'On, but nothing is asked online yet: choose a deposit or the full price below'}
                            </span>
                        </label>
                    )}
                    {!d.adminOff && payMode && <PaymentMode value={payMode} onSaved={setPayMode} />}
                    {d.payoutAccountReviewNeeded && <p style={{ ...muted, marginTop: '0.5rem' }}>Bookplus is checking your new bank account. Payouts start again once it is confirmed.</p>}
                </div>
            )}

            {d.status === 'approved' && <PaymentsMoney />}

            <div style={card}>
                <h3 style={{ ...h3, marginBottom: '0.75rem' }}>1. Choose a plan</h3>
                <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 15rem), 1fr))' }}>
                    {d.plans.map((p) => (
                        <PlanCard key={p.key} plan={p} processingFee={d.processingFee} minCommissionCents={d.minCommissionCents || 0} selected={d.plan === p.key} disabled={!editable || busy === 'plan'}
                            onChoose={choosePlan} />
                    ))}
                </div>
                <p style={{ ...muted, marginTop: '0.75rem', fontSize: '0.8rem' }}>
                    {!d.processingFee.known
                        ? 'A card processing fee charged by the card processor is added to these. Bookplus confirms it before online payments start.'
                        : d.processingFee.payer === 'business'
                            ? `The card processing fee, ${pct(d.processingFee.bps)}${d.processingFee.fixedCents ? ` + ${nad(d.processingFee.fixedCents)}` : ''} per payment, is taken from your payout. The card processor keeps it when a payment is refunded.`
                            : 'Bookplus pays the card processing fee.'}
                </p>
            </div>

            <form onSubmit={saveDetails} style={{ ...card, ...stack }}>
                <h3 style={h3}>2. Business details</h3>
                <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, ...stack }}>
                    <div>
                        <label style={label} htmlFor="op-type">What kind of business is it?</label>
                        <select id="op-type" value={legal.businessType} onChange={(e) => setLegal((l) => ({ ...l, businessType: e.target.value }))} style={input}>
                            <option value="">Choose…</option>
                            {BUSINESS_TYPES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={label} htmlFor="op-name">Registered business name</label>
                        <input id="op-name" value={legal.registeredName} maxLength={120} onChange={(e) => setLegal((l) => ({ ...l, registeredName: e.target.value }))} style={input} />
                    </div>
                    {legal.businessType !== 'sole_trader' && (
                        <div>
                            <label style={label} htmlFor="op-reg">Registration number</label>
                            <input id="op-reg" value={legal.registrationNumber} maxLength={40} onChange={(e) => setLegal((l) => ({ ...l, registrationNumber: e.target.value }))} style={input} placeholder="e.g. CC/2021/01234" />
                        </div>
                    )}
                    <div>
                        <label style={label} htmlFor="op-owner">Owner's full name</label>
                        <input id="op-owner" value={legal.ownerName} maxLength={100} onChange={(e) => setLegal((l) => ({ ...l, ownerName: e.target.value }))} style={input} />
                    </div>
                    <div>
                        <label style={label} htmlFor="op-id">Owner's ID or passport number</label>
                        <input id="op-id" value={legal.ownerIdNumber} maxLength={30} autoComplete="off" onChange={(e) => setLegal((l) => ({ ...l, ownerIdNumber: e.target.value }))} style={input}
                            placeholder={d.legal.hasOwnerIdNumber && editable ? 'Type a new number to replace it' : ''} aria-describedby="op-id-saved" />
                        {d.legal.hasOwnerIdNumber && (
                            <p id="op-id-saved" data-testid="id-saved" style={{ ...muted, fontSize: '0.8rem', marginTop: '0.3rem' }}>Saved: {d.legal.ownerIdNumberMasked}</p>
                        )}
                    </div>
                    {editable && <button type="submit" className="btn-primary" style={full} disabled={busy === 'details'}>{busy === 'details' ? 'Saving…' : 'Save details'}</button>}
                </fieldset>
            </form>

            <div style={{ ...card, ...stack }}>
                <div>
                    <h3 style={h3}>3. Documents</h3>
                    <p style={muted}>PDF, JPG or PNG, up to 10 MB each. Only Bookplus can open them, to check your business.</p>
                </div>
                {!d.uploadsAvailable && editable && <div role="alert" style={errBox}>Uploading documents is unavailable right now. Please try again later.</div>}
                {docs.map(([kind, title, hint]) => {
                    const have = d.documents.filter((doc) => doc.kind === kind);
                    return (
                        <div key={kind} data-testid={`doc-${kind}`} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                            <div>
                                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.92rem' }}>{title}</p>
                                <p style={{ ...muted, fontSize: '0.8rem' }}>{hint}</p>
                            </div>
                            {have.map((doc) => (
                                <div key={doc._id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.86rem', overflowWrap: 'anywhere' }}>{doc.name || 'Uploaded file'}</span>
                                    {editable && (
                                        <button type="button" className="btn-outline" style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem', flexShrink: 0 }} disabled={busy === `rm-${doc._id}`}
                                            onClick={() => run(`rm-${doc._id}`, () => onlinePaymentsService.removeDocument(doc._id))}>Remove</button>
                                    )}
                                </div>
                            ))}
                            {editable && d.uploadsAvailable && d.documents.length >= (d.maxDocuments || 8) && have.length === 0 && (
                                <p style={{ ...muted, fontSize: '0.8rem' }}>You have the most documents allowed. Remove one to add this.</p>
                            )}
                            {editable && d.uploadsAvailable && d.documents.length < (d.maxDocuments || 8) && (
                                <>
                                    <input ref={(el) => { fileRefs.current[kind] = el; }} id={`file-${kind}`} type="file" accept={VERIFICATION_ACCEPT}
                                        style={{ display: 'none' }} onChange={(e) => upload(kind, e.target.files?.[0])} />
                                    <button type="button" className="btn-outline" style={full} disabled={busy === `doc-${kind}`} onClick={() => fileRefs.current[kind]?.click()}>
                                        {busy === `doc-${kind}` ? 'Uploading…' : have.length ? 'Upload another' : 'Upload'}
                                    </button>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            <div style={{ ...card, ...stack }}>
                <div>
                    <h3 style={h3}>4. Bank account for payouts</h3>
                    <p style={muted}>The business's account Bookplus pays into. It must match the bank letter.</p>
                </div>
                {bankView?.hasAccount && !bankEditing ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.9rem' }}>{bankView.accountHolder}, {bankView.bankName}, {bankView.accountNumberMasked}</span>
                        {d.status === 'submitted'
                            ? <span style={{ ...muted, fontSize: '0.8rem' }}>Locked while Bookplus reviews it</span>
                            : <button type="button" className="btn-outline" style={{ fontSize: '0.8rem', padding: '0.35rem 0.8rem' }} onClick={editBank}>Change</button>}
                    </div>
                ) : (
                    <form onSubmit={saveBank} style={stack}>
                        {[['accountHolder', 'Account holder', 'text'], ['bankName', 'Bank', 'text'], ['branchCode', 'Branch code', 'numeric'], ['accountNumber', 'Account number', 'numeric']].map(([k, l, mode]) => (
                            <div key={k}>
                                <label style={label} htmlFor={`bank-${k}`}>{l}</label>
                                <input id={`bank-${k}`} value={bank[k]} inputMode={mode} autoComplete="off" onChange={(e) => setBank((b) => ({ ...b, [k]: e.target.value }))} style={input} />
                            </div>
                        ))}
                        {d.status === 'approved' && bankView?.hasAccount && <p style={muted}>Bookplus checks a new account before paying into it.</p>}
                        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: bankView?.hasAccount ? '1fr 1fr' : '1fr' }}>
                            {bankView?.hasAccount && <button type="button" className="btn-outline" style={full} onClick={() => setBankEditing(false)}>Cancel</button>}
                            <button type="submit" className="btn-primary" style={full} disabled={busy === 'bank'}>{busy === 'bank' ? 'Saving…' : 'Save bank account'}</button>
                        </div>
                    </form>
                )}
            </div>

            {editable && (
                <div style={{ ...card, ...stack }} data-testid="send-application">
                    <h3 style={h3}>5. Send to Bookplus</h3>
                    {d.missing.length > 0 ? (
                        <div>
                            <p style={{ ...muted, marginBottom: '0.35rem' }}>Still needed:</p>
                            <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--charcoal)', fontSize: '0.88rem', lineHeight: 1.7 }}>
                                {d.missing.map((m) => <li key={m}>{MISSING_TEXT[m] || m}</li>)}
                            </ul>
                        </div>
                    ) : <p style={muted}>Everything is in. Bookplus usually decides within a few working days.</p>}
                    <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.88rem' }}>
                        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ accentColor: 'var(--gold)', marginTop: '0.2rem' }} />
                        <span>I accept the <a href="/terms" target="_blank" rel="noreferrer" style={{ color: 'var(--gold-dark)' }}>Terms of Service</a> for online payments, including the fees above, refunds and chargebacks.</span>
                    </label>
                    <button type="button" className="btn-primary" style={full} disabled={!d.canSubmit || !terms || busy === 'submit'}
                        onClick={() => run('submit', () => onlinePaymentsService.submit(), 'Sent to Bookplus')}>
                        {busy === 'submit' ? 'Sending…' : d.status === 'info_requested' ? 'Send again' : 'Send application'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default OnlinePaymentsSection;
