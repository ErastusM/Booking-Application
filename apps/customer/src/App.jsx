import { useEffect, useState } from 'react';
import { BrandMark } from '@bookplus/ui';
import client from './client';

/**
 * Epic 1.1 vertical slice: prove the shared auth + API path end-to-end
 * (design-tokens theme, api-client login + silent-refresh interceptor, ui
 * package) before the page migration lands in Epic 1.2.
 */
export default function App() {
    const [user, setUser] = useState(null);
    const [checking, setChecking] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!localStorage.getItem('token')) { setChecking(false); return; }
        client.services.authService.getProfile()
            .then(res => setUser(res.data.data))
            .catch(() => {})
            .finally(() => setChecking(false));
    }, []);

    const login = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const res = await client.services.authService.login({ email, password });
            localStorage.setItem('token', res.data.data.token);
            if (res.data.data.refreshToken) localStorage.setItem('refreshToken', res.data.data.refreshToken);
            const profile = await client.services.authService.getProfile();
            setUser(profile.data.data);
        } catch (err) {
            setError(err.response?.data?.message || 'Login failed');
        }
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        setUser(null);
    };

    const input = {
        width: '100%', padding: '0.75rem 1rem', marginBottom: '0.75rem',
        border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-body)', fontSize: '0.95rem',
        color: 'var(--text-primary)', background: 'var(--input-bg)',
    };

    return (
        <div style={{ minHeight: '100vh', background: 'var(--off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)' }}>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', padding: '2.5rem', width: 'min(420px, 92vw)', textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', marginBottom: '1.5rem' }}>
                    <BrandMark size={36} />
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                        <span style={{ color: 'var(--charcoal)' }}>Book</span><span style={{ color: 'var(--gold)' }}>plus</span>
                    </span>
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }} data-testid="app-shell-label">
                    Customer app shell — Epic 1.1
                </p>

                {checking ? (
                    <p style={{ color: 'var(--text-muted)' }}>Checking session…</p>
                ) : user ? (
                    <div data-testid="authed-view">
                        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
                            Welcome, {user.name}
                        </h1>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                            Signed in via <code>@bookplus/api-client</code> · role: <strong data-testid="user-role">{user.role}</strong>
                        </p>
                        <button onClick={logout} style={{ background: 'var(--ink)', color: 'var(--on-ink)', border: 'none', borderRadius: 'var(--radius-pill)', padding: '0.7rem 1.6rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                            Log out
                        </button>
                    </div>
                ) : (
                    <form onSubmit={login} data-testid="login-form">
                        <input style={input} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} data-testid="email" />
                        <input style={input} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} data-testid="password" />
                        {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '0.75rem' }} data-testid="login-error">{error}</p>}
                        <button type="submit" style={{ width: '100%', background: 'var(--gold)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', padding: '0.8rem', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                            Sign in
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
