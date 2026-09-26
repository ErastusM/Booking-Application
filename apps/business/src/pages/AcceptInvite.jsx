import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import PasswordFields, { passwordMeetsRules } from '../components/auth/PasswordFields';
import NewLinkRequest from '../components/auth/NewLinkRequest';
import { AuthSplit, AuthTitle, AuthLead, Notice, linkStyle } from '../components/auth/AuthSplit';

/**
 * Accept-invite landing. An invited team member arrives from the emailed link,
 * sees who invited them, sets a password and is signed straight in to their
 * calendar.
 *
 * A small state machine, so every outcome says what actually happened:
 *   checking     skeleton, no inputs (nothing to type into that could vanish)
 *   unreachable  the preview call failed (network / 5xx / 429) after retries —
 *                NOT "expired"; offers Try again
 *   expired      7 days passed           ┐ "Email me a new link" (token)
 *   superseded   expired, newer one sent ┘
 *   invalid      unknown/missing token → email box for a new link
 *   revoked      the business withdrew access (archived)
 *   accepted     already used → "You're already set up"
 *   valid        the form
 *
 * This page renders WITHOUT the app chrome and useAuth leaves any session on
 * the device alone here (see App.jsx / useAuth) — a dead session used to
 * redirect the member to Sign In a fraction of a second after the form showed.
 */

const CODE_STATE = {
    INVITE_EXPIRED: 'expired',
    INVITE_SUPERSEDED: 'superseded',
    INVITE_ACCEPTED: 'accepted',
    INVITE_REVOKED: 'revoked',
    INVITE_INVALID: 'invalid',
};

// Preview retries for transient failures: 3 tries over ~3.5s before we say
// we couldn't check. Exported for tests.
export const PREVIEW_BACKOFF_MS = [700, 1400, 2800];

// A 429 is not "expired" and not a connection problem: say so plainly.
export const TOO_MANY = 'Too many attempts, try again in a few minutes.';

const formatDate = (d) => {
    try {
        return new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    } catch { return ''; }
};

const sameEmail = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const Skeleton = () => (
    <div data-testid="invite-checking" aria-busy="true" aria-label="Checking your invite">
        {[['70%', '2rem'], ['95%', '0.9rem'], ['60%', '0.9rem']].map(([w, h], i) => (
            <div key={i} style={{
                width: w, height: h, borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)',
                marginBottom: i === 0 ? '1rem' : '0.5rem', animation: 'bp-pulse 1.2s ease-in-out infinite',
            }} />
        ))}
        <div style={{ height: '1.5rem' }} />
        {[0, 1].map((i) => (
            <div key={i} style={{ height: '3rem', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)', marginBottom: '1rem', animation: 'bp-pulse 1.2s ease-in-out infinite' }} />
        ))}
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Checking your invite…</p>
        <style>{'@keyframes bp-pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }'}</style>
    </div>
);

const SignInLink = ({ email, label = 'Already set a password? Sign in' }) => (
    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', margin: '1.25rem 0 0' }}>
        <Link
            to={email ? `/login?email=${encodeURIComponent(email)}` : '/login'}
            style={linkStyle}
            data-testid="invite-signin-link"
        >
            {label}
        </Link>
    </p>
);

const AcceptInvite = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { login, refreshProfile, deviceSession } = useAuthContext();
    const token = searchParams.get('token');

    const [state, setState] = useState(token ? 'checking' : 'invalid');
    const [preview, setPreview] = useState(null);   // { name, email, businessName, returning, expiresAt }
    const [info, setInfo] = useState({});            // { newerSentAt, email } from a failure
    const [attempt, setAttempt] = useState(0);       // bump to re-run the preview
    const [rateLimited, setRateLimited] = useState(false); // last preview failure was a 429

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);

    // Preview the invite. A definite answer from the API (404 + code) decides
    // the state at once; anything transient is retried with backoff and ends
    // in 'unreachable' — never in "expired".
    useEffect(() => {
        if (!token) { setState('invalid'); return undefined; }
        let cancelled = false;
        let timer = null;
        setState('checking');
        setRateLimited(false);
        const run = async (n) => {
            try {
                const res = await authService.getStaffInvite(token);
                if (cancelled) return;
                const data = res.data?.data;
                if (data?.valid) { setPreview(data); setState('valid'); } else { setState('invalid'); }
            } catch (err) {
                if (cancelled) return;
                const st = err?.response?.status;
                const body = err?.response?.data || {};
                if (st === 404 || st === 400) {
                    setInfo({ newerSentAt: body.newerSentAt, email: body.email });
                    setState(CODE_STATE[body.code] || 'invalid');
                    return;
                }
                if (n < PREVIEW_BACKOFF_MS.length) {
                    timer = setTimeout(() => run(n + 1), PREVIEW_BACKOFF_MS[n]);
                } else {
                    setRateLimited(st === 429);
                    setState('unreachable');
                }
            }
        };
        run(0);
        return () => { cancelled = true; if (timer) clearTimeout(timer); };
    }, [token, attempt]);

    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();
        setError('');
        if (!passwordMeetsRules(password)) {
            setError('Your password needs everything in the list below the box.');
            return;
        }
        if (password !== confirm) {
            setError('The two passwords don’t match.');
            return;
        }
        setSubmitting(true);
        try {
            const res = await authService.acceptStaffInvite(token, password);
            const session = res.data?.data;
            // Signed in as the invitee from here on; any other session on this
            // device is replaced locally (never logged out server-side).
            login(session);
            // The server's view of their level is what the calendar gates on.
            await refreshProfile();
            navigate('/dashboard', { replace: true });
        } catch (err) {
            if (!mounted.current) return;
            const st = err?.response?.status;
            const body = err?.response?.data || {};
            setSubmitting(false);
            if (st === 400 && body.code && CODE_STATE[body.code]) {
                setInfo({ newerSentAt: body.newerSentAt, email: body.email || preview?.email });
                setState(CODE_STATE[body.code]);
                return;
            }
            if (!err?.response) {
                setError('We couldn’t reach Bookplus, so your password wasn’t set. Check your connection and try again.');
                return;
            }
            if (st === 429) {
                setError(`${TOO_MANY} Your password wasn’t set yet.`);
                return;
            }
            setError(body.message || 'Something went wrong setting your password. Please try again.');
        }
    }, [confirm, login, navigate, password, preview, refreshProfile, token]);

    const businessName = preview?.businessName || 'your team';
    const side = state === 'valid'
        ? <>You’re joining<br /><span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>{businessName}.</span></>
        : <>Your team,<br /><span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>your calendar.</span></>;
    const sideBody = 'Set a password and you’ll go straight to your own schedule — your bookings, your clients, your hours.';

    let body;
    if (state === 'checking') {
        body = <Skeleton />;
    } else if (state === 'unreachable') {
        body = (
            <div data-testid="invite-unreachable">
                <AuthTitle>We couldn’t check your invite</AuthTitle>
                <AuthLead>
                    {rateLimited
                        ? <>{TOO_MANY} Your link is still fine to use.</>
                        : 'Bookplus didn’t answer just now, so we couldn’t check your link. Check your connection and try again.'}
                </AuthLead>
                <button
                    type="button" className="btn-primary" style={{ width: '100%', padding: '0.875rem' }}
                    onClick={() => setAttempt((a) => a + 1)} data-testid="invite-retry"
                >
                    Try again
                </button>
                <SignInLink />
            </div>
        );
    } else if (state === 'expired' || state === 'superseded') {
        body = (
            <div data-testid={`invite-${state}`}>
                <AuthTitle>This invite has expired</AuthTitle>
                <AuthLead>
                    {state === 'superseded' && info.newerSentAt
                        ? <>Invite links work for 7 days. A newer invite was sent on <strong>{formatDate(info.newerSentAt)}</strong> — you can use that email, or get a fresh link now.</>
                        : <>Invite links work for 7 days and this one has run out. We can email you a fresh one — it’s the same invite, just a new link.</>}
                </AuthLead>
                <NewLinkRequest
                    send={() => authService.renewStaffInvite(token)}
                    sentMessage="If this invite can still be renewed, a new link is on its way to the email address it was sent to. It can take a minute — check your spam folder too."
                    testIdPrefix="invite-new-link"
                />
                <SignInLink />
            </div>
        );
    } else if (state === 'invalid') {
        body = (
            <div data-testid="invite-invalid">
                <AuthTitle>We can’t find this invite</AuthTitle>
                <AuthLead>
                    The link may be incomplete — try tapping the button in the email again. Or enter your email and we’ll send you a new link.
                </AuthLead>
                <NewLinkRequest
                    askEmail
                    send={(email) => authService.requestStaffInvite(email)}
                    sentMessage="If that address was invited to a team on Bookplus, a new link is on its way. It can take a minute — check your spam folder too."
                    testIdPrefix="invite-new-link"
                />
                <SignInLink />
            </div>
        );
    } else if (state === 'revoked') {
        body = (
            <div data-testid="invite-revoked">
                <AuthTitle>This invite was withdrawn</AuthTitle>
                <AuthLead>
                    The business that sent it no longer has you on its team. If that’s a mistake, ask them to invite you again — the new email will work straight away.
                </AuthLead>
                <SignInLink />
            </div>
        );
    } else if (state === 'accepted') {
        const acceptedEmail = info.email || preview?.email || '';
        const signedInHere = deviceSession && sameEmail(deviceSession.email, acceptedEmail);
        body = (
            <div data-testid="invite-accepted">
                <AuthTitle>You’re already set up</AuthTitle>
                <AuthLead>
                    This invite has been used{acceptedEmail ? <> — <strong>{acceptedEmail}</strong> already has a password</> : null}. Sign in to get to your calendar.
                </AuthLead>
                {signedInHere ? (
                    // A full load, so the app validates the saved session normally.
                    <a href="/dashboard" className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: '0.875rem' }} data-testid="invite-go-calendar">
                        Go to my calendar
                    </a>
                ) : (
                    <Link
                        to={acceptedEmail ? `/login?email=${encodeURIComponent(acceptedEmail)}` : '/login'}
                        className="btn-primary"
                        style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: '0.875rem' }}
                        data-testid="invite-sign-in"
                    >
                        Sign in
                    </Link>
                )}
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', margin: '1.25rem 0 0' }}>
                    <Link to="/forgot-password" style={linkStyle}>Forgot your password?</Link>
                </p>
            </div>
        );
    } else {
        const otherSession = deviceSession && preview?.email && !sameEmail(deviceSession.email, preview.email);
        body = (
            <div data-testid="invite-valid">
                <AuthTitle testId="invite-title">
                    {preview?.returning ? 'Welcome back to ' : 'You’re joining '}{businessName}
                </AuthTitle>
                <AuthLead>
                    {preview?.name ? <><strong>{preview.name}</strong>, set</> : 'Set'} a password
                    {preview?.email ? <> for <strong>{preview.email}</strong></> : null} to finish — you’ll go straight to your calendar.
                </AuthLead>

                {otherSession && (
                    <Notice tone="info" testId="invite-device-session">
                        You’re signed in as <strong>{deviceSession.name || deviceSession.email}</strong> on this device.
                        Accepting switches this device to <strong>{preview.email}</strong>.
                    </Notice>
                )}

                {error && <Notice tone="danger" role="alert" testId="invite-error">{error}</Notice>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', position: 'relative' }}>
                    <PasswordFields
                        password={password}
                        onPassword={setPassword}
                        confirm={confirm}
                        onConfirm={setConfirm}
                        username={preview?.email || ''}
                        testIdPrefix="accept"
                        disabled={submitting}
                    />
                    <button
                        type="submit"
                        disabled={submitting}
                        className="btn-primary"
                        style={{ width: '100%', padding: '0.875rem' }}
                        data-testid="accept-submit"
                    >
                        {submitting ? 'Setting up…' : 'Accept & go to my calendar →'}
                    </button>
                </form>
                <SignInLink email={preview?.email} />
            </div>
        );
    }

    return (
        <AuthSplit side={side} sideBody={sideBody} testId="accept-invite-page">
            <div data-state={state} data-testid="invite-state">{body}</div>
        </AuthSplit>
    );
};

export default AcceptInvite;
