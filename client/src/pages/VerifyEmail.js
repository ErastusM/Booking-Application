import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';

const VerifyEmail = () => {
    const [searchParams] = useSearchParams();
    const [status, setStatus] = useState('loading');
    const navigate = useNavigate();

    useEffect(() => {
        const s = searchParams.get('status');
        if (s) {
            setStatus(s);
            if (s === 'success') {
                setTimeout(() => navigate('/login'), 4000);
            }
        }
    }, [searchParams]);

    const config = {
        success: {
            icon: '✅',
            title: 'Email Verified!',
            message: 'Your account has been verified successfully. Redirecting you to login...',
            color: '#065f46',
            bg: '#d1fae5',
            border: '#6ee7b7',
        },
        expired: {
            icon: '⏰',
            title: 'Link Expired',
            message: 'This verification link has expired. Please register again to get a new link.',
            color: '#92400e',
            bg: '#fef3c7',
            border: '#fcd34d',
        },
        invalid: {
            icon: '❌',
            title: 'Invalid Link',
            message: 'This verification link is invalid. Please check your email or register again.',
            color: '#991b1b',
            bg: '#fee2e2',
            border: '#fca5a5',
        },
        error: {
            icon: '⚠️',
            title: 'Something went wrong',
            message: 'An error occurred during verification. Please try again later.',
            color: '#991b1b',
            bg: '#fee2e2',
            border: '#fca5a5',
        },
        loading: {
            icon: null,
            title: 'Verifying...',
            message: 'Please wait while we verify your email.',
            color: 'var(--text-secondary)',
            bg: 'var(--warm-gray)',
            border: 'var(--border)',
        },
    };

    const current = config[status] || config.loading;

    return (
        <div style={{ minHeight: '100vh', background: 'var(--off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
            <div style={{ width: '100%', maxWidth: '480px', textAlign: 'center' }} className="fade-up">

                {/* Logo */}
                <Link to="/" style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.8rem', fontWeight: '700', color: 'var(--gold)', textDecoration: 'none', display: 'block', marginBottom: '2.5rem' }}>
                    Book<span style={{ color: 'var(--charcoal)' }}>plus</span>
                </Link>

                <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
                    <div style={{ height: '4px', background: 'linear-gradient(to right, var(--gold-dark), var(--gold-light))' }} />
                    <div style={{ padding: '3rem 2rem' }}>

                        {status === 'loading' ? (
                            <div style={{ margin: '0 auto 1.5rem' }}>
                                <div style={{ width: '48px', height: '48px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
                            </div>
                        ) : (
                            <div style={{ fontSize: '3.5rem', marginBottom: '1.25rem' }}>{current.icon}</div>
                        )}

                        <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.8rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>
                            {current.title}
                        </h1>

                        <div style={{ background: current.bg, border: `1px solid ${current.border}`, borderRadius: 'var(--radius-sm)', padding: '0.875rem 1rem', marginBottom: '1.5rem' }}>
                            <p style={{ color: current.color, fontSize: '0.9rem', lineHeight: 1.6 }}>
                                {current.message}
                            </p>
                        </div>

                        {status === 'success' && (
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ width: '100%', height: '4px', background: 'var(--warm-gray)', borderRadius: '99px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', background: 'var(--gold)', borderRadius: '99px', animation: 'progress 4s linear forwards' }} />
                                </div>
                                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Redirecting to login in 4 seconds...</p>
                            </div>
                        )}

                        {status !== 'loading' && status !== 'success' && (
                            <Link to="/register" className="btn-primary" style={{ display: 'inline-block', padding: '0.875rem 2rem', textDecoration: 'none' }}>
                                Back to Register →
                            </Link>
                        )}

                        {status === 'success' && (
                            <Link to="/login" className="btn-primary" style={{ display: 'inline-block', padding: '0.875rem 2rem', textDecoration: 'none' }}>
                                Go to Login →
                            </Link>
                        )}
                    </div>
                </div>
            </div>
            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes progress { from { width: 0% } to { width: 100% } }
            `}</style>
        </div>
    );
};

export default VerifyEmail;