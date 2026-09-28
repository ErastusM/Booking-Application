import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Lock, ArrowRight, AlertTriangle } from 'lucide-react';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { nonAdminNotice, NOTICE_MS } from '../utils/adminPanel';

// Dedicated entrance for the admin console (/bkplus-command). It posts the SAME
// credentials as the normal business login — admin is just a business role — but
// makes it unmistakable which door you're at, and refuses to drop a non-admin
// into the console: a provider/staff who signs in here is sent to their own home
// with a note, rather than silently bounced. Deliberately committed to a dark,
// "restricted" look so it never reads like the provider sign-in.
const AdminLogin = () => {
    const { login, user, loading: authLoading } = useAuthContext();
    const navigate = useNavigate();
    const [form, setForm] = useState({ email: '', password: '' });
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

    const label = {
        display: 'block', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'rgba(230,232,231,0.66)', marginBottom: '0.5rem',
    };
    const field = {
        width: '100%', padding: '0.85rem 1rem', borderRadius: '10px',
        border: '1.5px solid rgba(230,232,231,0.45)', background: 'rgba(255,255,255,0.04)',
        color: 'var(--off-white)', fontSize: '0.95rem', fontFamily: 'var(--font-body)',
    };

    // There is no navbar (or its dark status-bar backdrop) on this route, so the
    // ink page runs up under the status bar itself: the negative margin takes back
    // the safe-area inset <main> pads, and the padding keeps the content below it.
    // Otherwise the installed app showed a light strip across the status bar.
    return (
        <div style={{
            minHeight: '100dvh', background: 'var(--ink)', color: 'var(--off-white)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1.5rem', position: 'relative', overflow: 'hidden',
            marginTop: 'calc(-1 * env(safe-area-inset-top, 0px))',
            paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))',
        }}>
            {/* Ambient brand wash + a thin command-line grid, kept very subtle */}
            <div aria-hidden="true" style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                backgroundImage: 'radial-gradient(ellipse at 50% -10%, rgba(240,62,22,0.10) 0%, transparent 55%)',
            }} />

            <div className="fade-up" style={{
                position: 'relative', zIndex: 1, width: '100%', maxWidth: '420px',
                background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(230,232,231,0.10)',
                borderRadius: '18px', padding: '2.25rem', backdropFilter: 'blur(6px)',
                boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
            }}>
                {/* Restricted badge */}
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                    background: 'rgba(240,62,22,0.14)', border: '1px solid rgba(240,62,22,0.35)',
                    color: 'var(--gold)', padding: '0.25rem 0.7rem', borderRadius: '99px',
                    fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                }}>
                    <Lock size={12} strokeWidth={2.5} /> Restricted
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.25rem 0 0.35rem' }}>
                    <ShieldCheck size={30} strokeWidth={2} style={{ color: 'var(--gold)' }} />
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 600, letterSpacing: '-0.02em' }}>
                        Book<span style={{ color: 'var(--gold)' }}>plus</span> Command
                    </div>
                </div>
                <p style={{ margin: 0, color: 'rgba(230,232,231,0.66)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                    Administrator sign-in. This console manages every business, booking and wallet on the platform.
                </p>

                {error && (
                    <div role="alert" style={{
                        marginTop: '1.4rem', background: 'rgba(220,20,60,0.12)', border: '1px solid rgba(220,20,60,0.4)',
                        color: '#ffb3c0', padding: '0.7rem 0.9rem', borderRadius: '10px', fontSize: '0.85rem',
                        display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
                    }}>
                        <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} /> {error}
                    </div>
                )}
                {notice && (
                    <div role="status" data-testid="not-admin-notice" style={{
                        marginTop: '1.4rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(230,232,231,0.16)',
                        color: 'rgba(230,232,231,0.85)', padding: '0.8rem 0.9rem 0.9rem', borderRadius: '10px', fontSize: '0.85rem',
                        overflow: 'hidden',
                    }}>
                        <div style={{ fontWeight: 600, color: 'var(--off-white)', marginBottom: '0.2rem' }}>This account isn’t an admin</div>
                        <div>{notice.text}</div>
                        <div aria-hidden="true" style={{ height: '3px', borderRadius: '99px', background: 'rgba(230,232,231,0.14)', marginTop: '0.7rem', overflow: 'hidden' }}>
                            <div className="admin-notice-bar" style={{ height: '100%', background: 'var(--gold)', transformOrigin: 'left', animation: `adminNoticeBar ${NOTICE_MS}ms linear forwards` }} />
                        </div>
                        <button type="button" onClick={() => navigate(notice.to, { replace: true })} style={{
                            marginTop: '0.7rem', background: 'none', border: '1px solid rgba(230,232,231,0.3)', color: 'var(--off-white)',
                            padding: '0.35rem 0.85rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)',
                        }}>Go now</button>
                        <style>{'@keyframes adminNoticeBar { from { transform: scaleX(0); } to { transform: scaleX(1); } } @media (prefers-reduced-motion: reduce) { .admin-notice-bar { animation: none !important; transform: scaleX(1); } }'}</style>
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', marginTop: '1.5rem' }}>
                    <div>
                        <label style={label} htmlFor="admin-email">Admin email</label>
                        <input id="admin-email" type="email" name="email" value={form.email} onChange={handleChange}
                            required autoComplete="username" placeholder="admin@bookplus.pro" style={field}
                            onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')}
                            onBlur={(e) => (e.target.style.borderColor = 'rgba(230,232,231,0.14)')} />
                    </div>
                    <div>
                        <label style={label} htmlFor="admin-pass">Password</label>
                        <input id="admin-pass" type="password" name="password" value={form.password} onChange={handleChange}
                            required autoComplete="current-password" placeholder="••••••••••" style={field}
                            onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')}
                            onBlur={(e) => (e.target.style.borderColor = 'rgba(230,232,231,0.14)')} />
                    </div>
                    <button type="submit" disabled={loading} style={{
                        marginTop: '0.35rem', width: '100%', padding: '0.9rem', borderRadius: '10px', border: 'none',
                        background: 'var(--gold)', color: 'var(--ink)', fontFamily: 'var(--font-body)', fontWeight: 600,
                        fontSize: '0.95rem', cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    }}>
                        {loading ? 'Verifying…' : <>Enter console <ArrowRight size={17} strokeWidth={2.5} /></>}
                    </button>
                </form>

                <p style={{ marginTop: '1.6rem', fontSize: '0.75rem', color: 'rgba(230,232,231,0.66)', lineHeight: 1.6 }}>
                    Not an administrator? Business owners and staff sign in at{' '}
                    <a href="/login" style={{ color: 'rgba(230,232,231,0.7)', textDecoration: 'underline' }}>the standard login</a>.
                </p>
            </div>
        </div>
    );
};

export default AdminLogin;
