import React, { useId, useState } from 'react';
import { Eye, EyeOff, Check, Circle } from 'lucide-react';

/**
 * New-password fields for the emailed-link pages (accept invite, reset password).
 *
 * The rules are shown BEFORE the person types and tick as they are met, so
 * nobody learns them from a rejection. They mirror the API's regex exactly
 * (authController: register / resetPassword / acceptStaffInvite) — in
 * particular only the listed symbols count as "a symbol".
 */
export const PASSWORD_SYMBOLS = '!@#$%^&*()_+-=[]{};\':"\\|,.<>/?';
const SYMBOL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

export const PASSWORD_RULES = [
    { id: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
    { id: 'upper', label: 'An uppercase letter (A–Z)', test: (pw) => /[A-Z]/.test(pw) },
    { id: 'number', label: 'A number (0–9)', test: (pw) => /\d/.test(pw) },
    { id: 'symbol', label: 'A symbol, like ! @ # ? or *', test: (pw) => SYMBOL_RE.test(pw) },
];

// The API's own check, verbatim. `.` excludes line breaks, as on the server.
export const API_PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

export const passwordMeetsRules = (pw) => API_PASSWORD_RE.test(pw || '');

const labelStyle = {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '0.5rem',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
};

const PasswordFields = ({
    password, onPassword, confirm, onConfirm,
    username = '', label = 'Create password', testIdPrefix = 'pw', disabled = false,
}) => {
    const [show, setShow] = useState(false);
    const ids = useId();
    const pwId = `${ids}-pw`;
    const cfId = `${ids}-cf`;
    const rulesId = `${ids}-rules`;
    const mismatch = confirm.length > 0 && confirm !== password;
    const matched = confirm.length > 0 && confirm === password;

    return (
        <>
            {/* Lets password managers file the new password under the right
                account: they look for a username field in the same form. */}
            <input
                type="email" name="username" autoComplete="username" value={username} readOnly
                tabIndex={-1} aria-hidden="true"
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            />
            <div>
                <label htmlFor={pwId} style={labelStyle}>{label}</label>
                <div style={{ position: 'relative' }}>
                    <input
                        id={pwId}
                        type={show ? 'text' : 'password'}
                        name="new-password"
                        autoComplete="new-password"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={password}
                        onChange={(e) => onPassword(e.target.value)}
                        required
                        disabled={disabled}
                        aria-describedby={rulesId}
                        className="input"
                        style={{ fontSize: '16px', paddingRight: '3rem' }}
                        data-testid={`${testIdPrefix}-password`}
                    />
                    <button
                        type="button"
                        onClick={() => setShow((s) => !s)}
                        aria-label={show ? 'Hide password' : 'Show password'}
                        aria-pressed={show}
                        data-testid={`${testIdPrefix}-toggle`}
                        style={{
                            position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                            width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                            borderRadius: 'var(--radius-sm)',
                        }}
                    >
                        {show ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                </div>
                <ul
                    id={rulesId}
                    aria-label="Password rules"
                    data-testid={`${testIdPrefix}-rules`}
                    style={{ listStyle: 'none', margin: '0.65rem 0 0', padding: 0, display: 'grid', gap: '0.3rem' }}
                >
                    {PASSWORD_RULES.map((r) => {
                        const ok = r.test(password);
                        return (
                            <li
                                key={r.id}
                                data-rule={r.id}
                                data-met={ok ? 'true' : 'false'}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem',
                                    color: ok ? 'var(--success-fg)' : 'var(--text-muted)',
                                    transition: 'color var(--dur-fast, 0.15s)',
                                }}
                            >
                                {ok ? <Check size={14} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" style={{ margin: '0 2px' }} />}
                                <span>{r.label}</span>
                                <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                                    {ok ? ' — done' : ' — not yet'}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </div>

            <div>
                <label htmlFor={cfId} style={labelStyle}>Confirm password</label>
                <input
                    id={cfId}
                    type={show ? 'text' : 'password'}
                    name="confirm-password"
                    autoComplete="new-password"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={confirm}
                    onChange={(e) => onConfirm(e.target.value)}
                    required
                    disabled={disabled}
                    aria-invalid={mismatch ? 'true' : undefined}
                    className="input"
                    style={{ fontSize: '16px' }}
                    data-testid={`${testIdPrefix}-confirm`}
                />
                <p
                    aria-live="polite"
                    style={{
                        margin: '0.4rem 0 0', minHeight: '1.1rem', fontSize: '0.82rem',
                        color: mismatch ? 'var(--danger-fg)' : 'var(--success-fg)',
                    }}
                >
                    {mismatch ? 'Passwords don’t match yet' : matched ? 'Passwords match' : ''}
                </p>
            </div>
        </>
    );
};

export default PasswordFields;
