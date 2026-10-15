import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { panel as card, h2, h3, muted, input, label, errBox } from './admin/ui';
import '../styles/admin.css';

// Two-step sign-in (an authenticator app) for admin accounts. The API refuses
// every admin request from a session that hasn't passed it in the last 12 hours
// (middleware/auth), so the whole console sits behind AdminTwoStepGate: set it
// up, or confirm a code, before anything loads. A request refused later in the
// session (the 12 hours ran out) brings the code screen back
// (packages/api-client fires 'admin-two-step-required').

const fullButton = { width: '100%', justifyContent: 'center', textAlign: 'center' };

const apiError = (err, fallback) => err?.response?.data?.message || fallback;

export const TWO_STEP_EVENT = 'admin-two-step-required';

// The signed-in admin's two-step status (e.g. recoveryCodesLeft) for the console.
export const TwoStepStatus = createContext(null);
export const useTwoStepStatus = () => useContext(TwoStepStatus);

const CodeInput = ({ value, onChange, id, placeholder = '123456' }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="one-time-code" inputMode="text"
        maxLength={14} placeholder={placeholder}
        style={{ ...input, letterSpacing: '0.25em', fontSize: '1.15rem', textAlign: 'center', padding: '0.75rem' }} />
);

// One numbered step of the set-up: number, title, then its content.
const Step = ({ n, title, children }) => (
    <section style={{ display: 'grid', gap: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
        <h3 style={{ ...h3, margin: 0, display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
            <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{n}.</span>
            <span>{title}</span>
        </h3>
        {children}
    </section>
);

export const MfaSetup = ({ onDone }) => {
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
                <p style={muted}>The admin console needs a code from an authenticator app (Google Authenticator, Microsoft Authenticator or similar) as well as your password. After this, signing in to the console asks for the code too.</p>
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

export const MfaConfirm = ({ onDone }) => {
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

/** Shows `children` only in a session that passed two-step sign-in. */
export const AdminTwoStepGate = ({ children }) => {
    const [status, setStatus] = useState(null);
    const [error, setError] = useState('');
    // While the set-up is on screen, a late refusal from an earlier request
    // must not swap it out before the recovery codes are saved.
    const settingUp = useRef(false);

    const load = useCallback(async () => {
        try { setStatus((await authService.mfaStatus()).data.data); setError(''); } catch (err) { setError(apiError(err, 'Could not load.')); }
    }, []);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        const onRefused = () => { if (!settingUp.current) load(); };
        window.addEventListener(TWO_STEP_EVENT, onRefused);
        return () => window.removeEventListener(TWO_STEP_EVENT, onRefused);
    }, [load]);
    const setupDone = useCallback(() => { settingUp.current = false; load(); }, [load]);

    const ready = status?.enabled && status?.sessionConfirmed;
    settingUp.current = !!status && !status.enabled;
    if (ready) return <TwoStepStatus.Provider value={status}>{children}</TwoStepStatus.Provider>;
    return (
        <div className="adm-door" data-testid="admin-two-step-gate">
            <div className="adm-door-box" style={{ maxWidth: '26rem' }}>
                <div className="adm-brand"><b>Book<span>plus</span></b><small>Admin</small></div>
                {error ? <div role="alert" style={errBox}>{error}</div>
                    : !status ? <p style={muted}>Loading…</p>
                        : !status.enabled ? <MfaSetup onDone={setupDone} />
                            : <MfaConfirm onDone={load} />}
            </div>
        </div>
    );
};

export default AdminTwoStepGate;
