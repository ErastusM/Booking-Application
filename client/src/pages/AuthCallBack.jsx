import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';

const AuthCallback = () => {
    const { login } = useAuthContext();
    const navigate = useNavigate();

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        const refreshToken = params.get('refreshToken');
        const id = params.get('id');
        const role = params.get('role');
        const name = params.get('name');
        const email = params.get('email');
        const avatar = params.get('avatar');

        if (token) {
            // Store token first so restoreSession can use it
            localStorage.setItem('token', token);
            if (refreshToken) localStorage.setItem('refreshToken', refreshToken);

            // Call login with the full user shape
            login({
                token,
                user: {
                    _id: id,
                    id,
                    role,
                    name,
                    email,
                    avatar: avatar || null,
                    phone: 'pending',
                },
            });

            // Small delay to let auth state settle before redirecting
            setTimeout(() => {
                const phoneValue = params.get('phone');
                const needsPhone = !phoneValue || phoneValue === 'pending';
                if (needsPhone) {
                    navigate('/complete-profile');
                } else if (role === 'admin') {
                    navigate('/admin/dashboard');
                } else if (role === 'provider') {
                    navigate('/dashboard');
                } else {
                    navigate('/');
                }
            }, 500);
        } else {
            navigate('/login?error=google_failed');
        }
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