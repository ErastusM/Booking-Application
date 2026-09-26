import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services';
import PasswordFields, { passwordMeetsRules } from '../components/auth/PasswordFields';
import NewLinkRequest from '../components/auth/NewLinkRequest';
import { AuthSplit, AuthTitle, AuthLead, Notice, linkStyle } from '../components/auth/AuthSplit';

/**
 * Set a new password from an emailed reset link. Like /accept-invite, this is
 * an emailed-link page: it renders without the app chrome and a dead session
 * on the device can no longer redirect it away (api-client PUBLIC_TOKEN_PATHS).
 * A spent or expired link offers "Email me a new link" right here.
 */
const ResetPassword = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [expired, setExpired] = useState(!token);

    useEffect(() => {
        if (!success) return undefined;
        const t = setTimeout(() => navigate('/login'), 3000);
        return () => clearTimeout(t);
    }, [success, navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!passwordMeetsRules(password)) {
            return setError('Your password needs everything in the list below the box.');
        }
        if (password !== confirm) {
            return setError('The two passwords don’t match.');
        }
        setLoading(true);
        try {
            await authService.resetPassword({ token, password });
            setSuccess(true);
        } catch (err) {
            const msg = err.response?.data?.message || '';
            if (err.response?.status === 400 && /invalid or has expired/i.test(msg)) {
                setExpired(true);
            } else if (!err.response) {
                setError('We couldn’t reach Bookplus, so your password wasn’t changed. Check your connection and try again.');
            } else {
                setError(msg || 'Something went wrong. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    let body;
    if (success) {
        body = (
            <div data-testid="reset-success">
                <AuthTitle>Password updated</AuthTitle>
                <AuthLead>Your new password is set. Taking you to sign in…</AuthLead>
                <Link to="/login" className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: '0.875rem' }}>
                    Sign in
                </Link>
            </div>
        );
    } else if (expired) {
        body = (
            <div data-testid="reset-expired">
                <AuthTitle>{token ? 'This reset link has expired' : 'This reset link is incomplete'}</AuthTitle>
                <AuthLead>
                    Reset links work for an hour and only once. Enter your email and we’ll send you a new one.
                </AuthLead>
                <NewLinkRequest
                    askEmail
                    send={(email) => authService.forgotPassword(email)}
                    sentMessage="If that address has a Bookplus business account, a new reset link is on its way. It can take a minute — check your spam folder too."
                    testIdPrefix="reset-new-link"
                />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', margin: '1.25rem 0 0' }}>
                    <Link to="/login" style={linkStyle}>Remembered it? Sign in</Link>
                </p>
            </div>
        );
    } else {
        body = (
            <div data-testid="reset-form">
                <AuthTitle>Choose a new password</AuthTitle>
                <AuthLead>Enter and confirm your new password below.</AuthLead>
                {error && <Notice tone="danger" role="alert" testId="reset-error">{error}</Notice>}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', position: 'relative' }}>
                    <PasswordFields
                        password={password}
                        onPassword={setPassword}
                        confirm={confirm}
                        onConfirm={setConfirm}
                        label="New password"
                        testIdPrefix="reset"
                        disabled={loading}
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary"
                        style={{ width: '100%', padding: '0.875rem' }}
                        data-testid="reset-submit"
                    >
                        {loading ? 'Saving…' : 'Set new password →'}
                    </button>
                </form>
            </div>
        );
    }

    return (
        <AuthSplit
            side={<>Choose a new<br /><span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>password.</span></>}
            sideBody="Make it strong: at least 8 characters with an uppercase letter, a number and a symbol."
        >
            {body}
        </AuthSplit>
    );
};

export default ResetPassword;
