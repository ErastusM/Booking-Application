import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { nonAdminNotice, NOTICE_MS } from '../utils/adminPanel';
import '../styles/admin.css';

// Dedicated entrance for the admin console (/bkplus-command). It posts the SAME
// credentials as the normal business login (admin is just a business role) and
// refuses to drop a non-admin into the console: a provider/staff who signs in
// here is sent to their own home with a note, rather than silently bounced.
// Plain, like the console itself.
const AdminLogin = () => {
    const { login, user, loading: authLoading } = useAuthContext();
    const navigate = useNavigate();
    const location = useLocation();
    const [form, setForm] = useState({ email: '', password: '' });
    // Two-step sign-in: after a correct password the API answers with a short
    // ticket, and the code from the authenticator app finishes the sign-in.
    // The standard login page hands an admin's ticket over here.
    const [mfaToken, setMfaToken] = useState(() => location.state?.mfaToken || null);
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState(null); // { text, to } for a non-admin

    // Set while THIS page is showing that note, so the effect below doesn't
    // redirect the instant login() sets the user — which is what used to make
    // the note never appear at all.
    const noticeShown = useRef(false);

    // Already signed in? An admin goes straight to the console; anyone else is
    // told this isn't an admin account, then taken to where they belong.
    useEffect(() => {
        if (authLoading || !user || noticeShown.current) return undefined;
        if (user.role === 'admin') { navigate('/bkplus-command', { replace: true }); return undefined; }
        noticeShown.current = true;
        const n = nonAdminNotice(user.role);
        setNotice(n);
        const t = setTimeout(() => navigate(n.to, { replace: true }), NOTICE_MS);
        return () => clearTimeout(t);
    }, [user, authLoading, navigate]);

    const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true); setError(''); setNotice(null);
        try {
            const res = await authService.login(form);
            const data = res.data.data;
            if (data?.mfaRequired) { setMfaToken(data.mfaToken); setCode(''); return; }
            const role = data?.user?.role;
            if (role !== 'admin') {
                // Valid credentials, wrong door. Sign them in, say so, then send
                // them home (noticeShown keeps the effect above from jumping first).
                noticeShown.current = true;
                const n = nonAdminNotice(role);
                setNotice(n);
                login(data);
                setTimeout(() => navigate(n.to, { replace: true }), NOTICE_MS);
                return;
            }
            login(data);
            navigate('/bkplus-command', { replace: true });
        } catch (err) {
            // Deliberately generic — don't reveal whether the email is an admin.
            setError(err.response?.data?.message || 'Those credentials were not accepted.');
        } finally {
            setLoading(false);
        }
    };

    const handleCode = async (e) => {
        e.preventDefault();
        setLoading(true); setError('');
        try {
            const res = await authService.mfaLogin(mfaToken, code.trim());
            const data = res.data.data;
            login(data);
            navigate('/bkplus-command', { replace: true });
        } catch (err) {
            const c = err.response?.data?.code;
            if (c === 'mfa_ticket_expired') { setMfaToken(null); setForm((p) => ({ ...p, password: '' })); }
            setError(err.response?.data?.message || 'That code was not accepted.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="adm-door">
            <div className="adm-door-box">
                <div className="adm-brand"><b>Book<span>plus</span></b><small>Admin</small></div>
                <div className="adm-panel">
                    <div className="adm-panel-body">
                        <h1>{mfaToken ? 'Enter your code' : 'Sign in to the admin console'}</h1>
                        {error && <div role="alert" className="adm-error">{error}</div>}
                        {notice && (
                            <div role="status" data-testid="not-admin-notice" className="adm-note" style={{ display: 'grid', gap: 8 }}>
                                <strong>This account isn’t an admin</strong>
                                <span>{notice.text}</span>
                                <div><button type="button" className="btn-outline" onClick={() => navigate(notice.to, { replace: true })}>Go now</button></div>
                            </div>
                        )}
                        {mfaToken ? (
                            <form onSubmit={handleCode} style={{ display: 'grid', gap: 14 }}>
                                <div>
                                    <label className="adm-label" htmlFor="admin-code">Code from your authenticator app</label>
                                    <input id="admin-code" name="code" className="adm-input" value={code} onChange={(e) => setCode(e.target.value)}
                                        required autoFocus autoComplete="one-time-code" inputMode="text" maxLength={14} placeholder="123456"
                                        style={{ letterSpacing: '0.2em', fontSize: '1.05rem' }} data-testid="admin-mfa-code" />
                                    <p className="adm-muted" style={{ marginTop: 6 }}>Lost your phone? Enter one of your recovery codes instead.</p>
                                </div>
                                <button type="submit" className="btn-primary" disabled={loading || !code.trim()}>{loading ? 'Checking…' : 'Confirm'}</button>
                                <button type="button" className="adm-link" style={{ justifySelf: 'center' }} onClick={() => { setMfaToken(null); setCode(''); setError(''); }}>Start again</button>
                            </form>
                        ) : (
                            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
                                <div>
                                    <label className="adm-label" htmlFor="admin-email">Admin email</label>
                                    <input id="admin-email" type="email" name="email" className="adm-input" value={form.email} onChange={handleChange}
                                        required autoComplete="username" />
                                </div>
                                <div>
                                    <label className="adm-label" htmlFor="admin-pass">Password</label>
                                    <input id="admin-pass" type="password" name="password" className="adm-input" value={form.password} onChange={handleChange}
                                        required autoComplete="current-password" />
                                </div>
                                <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
                            </form>
                        )}
                    </div>
                </div>
                <p className="adm-muted" style={{ marginTop: 14 }}>
                    Business owners and team members sign in at <a href="/login" style={{ color: 'inherit' }}>the business login</a>.
                </p>
            </div>
        </div>
    );
};

export default AdminLogin;
