import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import API from '../services/api';
import FinishGoogleSignup from '../components/FinishGoogleSignup';

const AuthCallback = () => {
    const { login } = useAuthContext();
    const navigate = useNavigate();
    const [error, setError] = useState('');

    // The one-time values in this URL (?code= / ?signup=) are credentials: read
    // them once, then drop them from the address bar and history.
    const [params] = useState(() => new URLSearchParams(window.location.search));
    const signupCode = params.get('signup');

    const handleSession = ({ token, refreshToken, user }) => {
        localStorage.setItem('token', token);
        if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
        login({ token, user });

        setTimeout(() => {
            const needsPhone = !user.phone || user.phone === 'pending';
            if (needsPhone) {
                navigate('/complete-profile');
            } else if (user.role === 'admin') {
                navigate('/bkplus-command');
            } else if (user.role === 'provider') {
                navigate('/dashboard');
            } else {
                navigate('/');
            }
        }, 500);
    };

    useEffect(() => {
        const code = params.get('code');
        try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }

        // First-time Google sign-in: the FinishGoogleSignup step below takes over.
        if (signupCode) return;

        if (!code) {
            navigate('/login?error=google_failed');
            return;
        }

        API.post('/auth/exchange-code', { code })
            .then(({ data }) => {
                if (data.success) {
                    handleSession(data.data);
                } else {
                    setError(data.message || 'Authentication failed');
                    setTimeout(() => navigate('/login?error=google_failed'), 2000);
                }
            })
            .catch((err) => {
                setError(err.response?.data?.message || 'Authentication failed. Please try again.');
                setTimeout(() => navigate('/login?error=google_failed'), 2000);
            });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (signupCode) {
        return (
            <FinishGoogleSignup
                code={signupCode}
                onDone={(data) => handleSession(data)}
                onCancel={() => navigate('/login')}
            />
        );
    }

    return (
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--off-white)' }}>
            <div style={{ textAlign: 'center' }}>
                {error ? (
                    <>
                        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚠️</div>
                        <p style={{ color: '#991b1b', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>{error}</p>
                        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Redirecting to login...</p>
                    </>
                ) : (
                    <>
                        <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
                        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>Signing you in with Google...</p>
                    </>
                )}
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default AuthCallback;
