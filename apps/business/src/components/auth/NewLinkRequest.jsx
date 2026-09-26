import React, { useState } from 'react';
import { Notice } from './AuthSplit';

/**
 * "Email me a new link" for a dead emailed link (expired invite, used reset
 * link…). With `send(email?)` the caller decides which endpoint to hit.
 *
 * Whatever the server answers, the person sees the same neutral confirmation —
 * the API deliberately never says whether an account exists, and the page must
 * not either. Only a request that never reached the server (offline) is
 * reported as a failure, so they know to try again.
 */
const NewLinkRequest = ({
    send, askEmail = false, initialEmail = '', buttonLabel = 'Email me a new link',
    sentMessage, testIdPrefix = 'new-link',
}) => {
    const [email, setEmail] = useState(initialEmail);
    const [status, setStatus] = useState('idle');     // idle | sending | sent | offline | limited
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        const addr = email.trim();
        if (askEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
            setError('Enter the email address your invite was sent to.');
            return;
        }
        setStatus('sending');
        try {
            await send(askEmail ? addr : undefined);
            setStatus('sent');
        } catch (err) {
            // Any other HTTP answer gets the neutral confirmation. A 429 comes
            // from the limiter before any lookup, so saying so reveals nothing;
            // "no answer at all" is worth telling apart too.
            const st = err?.response?.status;
            if (st === 429) setStatus('limited');
            else setStatus(err && err.response ? 'sent' : 'offline');
        }
    };

    if (status === 'sent') {
        return (
            <Notice tone="success" testId={`${testIdPrefix}-sent`} role="status">
                {sentMessage || 'If this link can be renewed, a new one is on its way to the email address it was sent to. It can take a minute — check your spam folder too.'}
            </Notice>
        );
    }

    return (
        <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {askEmail && (
                <div>
                    <label
                        htmlFor={`${testIdPrefix}-email`}
                        style={{
                            display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)',
                            marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase',
                        }}
                    >
                        Your email address
                    </label>
                    <input
                        id={`${testIdPrefix}-email`}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="off"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="input"
                        style={{ fontSize: '16px' }}
                        data-testid={`${testIdPrefix}-email`}
                        aria-invalid={error ? 'true' : undefined}
                    />
                </div>
            )}
            {error && <Notice tone="danger" role="alert">{error}</Notice>}
            {status === 'offline' && (
                <Notice tone="danger" role="alert" testId={`${testIdPrefix}-offline`}>
                    We couldn’t reach Bookplus. Check your connection and try again.
                </Notice>
            )}
            {status === 'limited' && (
                <Notice tone="warning" role="alert" testId={`${testIdPrefix}-limited`}>
                    Too many attempts, try again in a few minutes.
                </Notice>
            )}
            <button
                type="submit"
                className="btn-primary"
                disabled={status === 'sending'}
                style={{ width: '100%', padding: '0.875rem' }}
                data-testid={`${testIdPrefix}-button`}
            >
                {status === 'sending' ? 'Sending…' : buttonLabel}
            </button>
        </form>
    );
};

export default NewLinkRequest;
