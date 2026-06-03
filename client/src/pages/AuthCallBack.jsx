import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';

const AuthCallback = () => {
    const { login } = useAuthContext();
    const navigate = useNavigate();

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (!code) {
            navigate('/login?error=google_failed');
            return;
        }

        const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';

        fetch(`${apiUrl}/api/auth/exchange-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    const { token, refreshToken, user } = data.data;
                    localStorage.setItem('token', token);
                    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
                    login({ token, user });

                    setTimeout(() => {
                        const needsPhone = !user.phone || user.phone === 'pending';
                        if (needsPhone) {
                            navigate('/complete-profile');
                        } else if (user.role === 'admin') {
                            navigate('/admin/dashboard');
                        } else if (user.role === 'provider') {
                            navigate('/dashboard');
                        } else {
                            navigate('/');
                        }
                    }, 500);
                } else {
                    navigate('/login?error=google_failed');
                }
            })
            .catch(() => navigate('/login?error=google_failed'));
    }, []);

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--off-white)' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
                <p style={{ color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>Signing you in with Google...</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default AuthCallback;