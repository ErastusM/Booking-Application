import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNav, useQueryParams } from '../routing';
import { CheckCircle, Clock, XCircle, AlertTriangle, Loader } from 'lucide-react';

const VerifyEmail = () => {
    const searchParams = useQueryParams();
    const [status, setStatus] = useState('loading');
    const [role, setRole] = useState('customer');
    const navigate = useNav();

    useEffect(() => {
        const s = searchParams.get('status');
        const r = searchParams.get('role');
        if (r) setRole(r);
        if (s) {
            setStatus(s);
            if (s === 'success') {
                setTimeout(() => navigate('/login'), 4000);
            }
        }
    }, [searchParams]);

    const successMessage = role === 'provider'
        ? 'Your business account is active. Head to your dashboard to complete your profile and start receiving bookings.'
        : 'Your account is verified. You can now discover businesses and book appointments.';

    const config = {
        success: {
            Icon: CheckCircle,
            iconColor: '#0e7a4f',
            title: 'Email Verified!',
            message: successMessage,
            color: '#0e7a4f',
            bg: '#e7f6ee',
            border: '#6ee7b7',
        },
        expired: {
            Icon: Clock,
            iconColor: '#92400e',
            title: 'Link Expired',
            message: 'This verification link has expired. Please register again or use "resend the link" on the sign-up screen to get a new one.',
            color: '#92400e',
            bg: '#fef3c7',
            border: '#fcd34d',
        },
        invalid: {
            Icon: XCircle,
            iconColor: '#991b1b',
            title: 'Invalid Link',
            message: 'This verification link is invalid. Please check your email or register again.',
            color: '#991b1b',
            bg: '#fee2e2',
            border: '#fca5a5',
        },
        error: {
            Icon: AlertTriangle,
            iconColor: '#991b1b',
            title: 'Something went wrong',
            message: 'An error occurred during verification. Please try again later.',
            color: '#991b1b',
            bg: '#fee2e2',
            border: '#fca5a5',
        },
        loading: {
            Icon: Loader,
            iconColor: 'var(--text-muted)',
            title: 'Verifying...',
            message: 'Please wait while we verify your email.',
            color: 'var(--text-secondary)',
            bg: 'var(--warm-gray)',
            border: 'var(--border)',
        },
    };

    const current = config[status] || config.loading;
    const { Icon } = current;

    return (
        <div style={{ minHeight: '100dvh', background: 'var(--off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
            <div style={{ width: '100%', maxWidth: '480px', textAlign: 'center' }} className="fade-up">

                <Link to="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: '700', color: 'var(--charcoal)', textDecoration: 'none', display: 'block', marginBottom: '2.5rem' }}>
                    Book<span style={{ color: 'var(--gold)' }}>plus</span>
                </Link>

                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
                    <div style={{ height: '4px', background: 'linear-gradient(to right, var(--gold-dark), var(--gold-light))' }} />
                    <div style={{ padding: '3rem 2rem' }}>

                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
                            {status === 'loading'
                                ? <div style={{ width: '48px', height: '48px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                : <Icon size={52} strokeWidth={1.5} style={{ color: current.iconColor }} />
                            }
                        </div>

                        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>
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
                                Back to Register
                            </Link>
                        )}

                        {status === 'success' && (
                            <Link to="/login" className="btn-primary" style={{ display: 'inline-block', padding: '0.875rem 2rem', textDecoration: 'none' }}>
                                Go to Login
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
