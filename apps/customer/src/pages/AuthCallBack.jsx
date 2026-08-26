import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import API, { API_BASE } from '../services/api';

const BUSINESS_URL = import.meta.env.VITE_BUSINESS_URL || 'http://localhost:3003';

const AuthCallback = () => {
    const { login } = useAuthContext();
    const navigate = useNavigate();
    const [error, setError] = useState('');
    // A business account exists on this Google address too. Signing in with
    // Google used to skip the question entirely and drop them on whichever side
    // the button was on — the same defect the password login had.
    const [choice, setChoice] = useState(null); // { otherSide, email }

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        // Arriving via the account switcher (or a just-created customer account):
        // the destination is already decided, so skip the "which side?" chooser
        // the Google login shows — asking again would undo the switch.
        const switched = params.get('switch') === '1';

        if (!code) {
            navigate('/login?error=google_failed');
            return;
        }

        API.post('/auth/exchange-code', { code })
            .then(({ data }) => {
                if (data.success) {
                    const { token, refreshToken, user, otherSide } = data.data;
                    localStorage.setItem('token', token);
                    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
                    login({ token, user });

                    setTimeout(() => {
                        const needsPhone = !user.phone || user.phone === 'pending';
                        if (needsPhone) {
                            navigate('/complete-profile');
                        } else if (!switched && user.role === 'customer' && otherSide?.accountType === 'business') {
                            // Ask, exactly as the password login does — unless the
                            // switcher already decided this is where they want to be.
                            setChoice({ otherSide, email: user.email });
                        } else if (user.role !== 'customer') {
                            // Business accounts (provider/staff/admin) live in the
                            // business app — hard nav; the SSO cookie set by the code
                            // exchange lets it bootstrap the session over there.
                            const businessUrl = import.meta.env.VITE_BUSINESS_URL || 'http://localhost:3003';
                            window.location.href = user.role === 'admin'
                                ? `${businessUrl}/bkplus-command`
                                : `${businessUrl}/dashboard`;
                        } else {
                            navigate('/');
                        }
                    }, 500);
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

    // Business Dashboard: if the SAME Google identity owns that account, just
    // re-run Google against the business side and they are in. Otherwise it has
    // its own credentials — hand them to the business door with the email
    // filled in rather than pretending we can sign them in.
    const goToBusiness = () => {
        if (choice?.otherSide?.sameCredentials) {
            window.location.href = `${API_BASE}/api/auth/google?role=provider`;
            return;
        }
        const q = new URLSearchParams({ email: choice?.email || '', from: 'website' });
        window.location.href = `${BUSINESS_URL}/login?${q}`;
    };

    if (choice) {
        return (
            <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--off-white)', padding: '1.5rem' }}>
                <div data-testid="destination-chooser" style={{ width: '100%', maxWidth: '380px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <p style={{ color: 'var(--charcoal)', fontSize: '1.05rem', fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}>
                        Where would you like to go?
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
                        This email has both a customer and a business account.
                        {!choice.otherSide?.sameCredentials
                            && ' Your business account has its own sign-in, so you’ll sign in again over there.'}
                    </p>
                    <button type="button" className="btn-primary" onClick={goToBusiness}
                        data-testid="choose-business" style={{ width: '100%', padding: '0.875rem' }}>
                        Business Dashboard →
                    </button>
                    <button type="button" className="btn-outline" onClick={() => navigate('/')}
                        data-testid="choose-customer" style={{ width: '100%', padding: '0.875rem' }}>
                        Customer Site
                    </button>
                </div>
            </div>
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
