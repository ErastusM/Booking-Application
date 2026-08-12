import React from 'react';

/**
 * A toggle built on a real checkbox.
 *
 * The visible track and knob are decoration painted OVER an invisible
 * `<input type="checkbox">` that fills the same box. That layering is what
 * gives us keyboard focus, form semantics and screen-reader support for free —
 * and it is also how this control once shipped completely inert: the track is
 * on top, so without `pointer-events: none` it swallows every click and the
 * switch cannot be operated by mouse or touch at all. It looks perfectly
 * normal while doing nothing, which is why `Switch.test.jsx` pins the property
 * rather than trusting the style to survive the next edit.
 */
const Switch = ({ checked, onChange, disabled, label, 'data-testid': testId }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
        <span style={{
            fontSize: '0.78rem', fontWeight: 650, whiteSpace: 'nowrap',
            color: checked ? 'var(--gold-dark)' : 'var(--text-muted)',
        }}>{label}</span>
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <input
                type="checkbox"
                role="switch"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                data-testid={testId}
                style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    opacity: 0, margin: 0, cursor: disabled ? 'not-allowed' : 'pointer',
                }}
            />
            <span aria-hidden="true" data-track="1" style={{
                width: '42px', height: '24px', borderRadius: '999px', position: 'relative',
                background: checked ? 'var(--gold)' : 'var(--border)',
                transition: 'background 0.16s ease', opacity: disabled ? 0.5 : 1,
                // The real checkbox sits invisibly underneath this track. Without
                // this the track swallows every click and the switch is inert —
                // it looks fine and simply cannot be operated by mouse or touch.
                pointerEvents: 'none',
            }}>
                <span style={{
                    position: 'absolute', top: '3px', left: '3px', width: '18px', height: '18px',
                    borderRadius: '50%', background: '#fff', transition: 'transform 0.16s ease',
                    transform: checked ? 'translateX(18px)' : 'none',
                    boxShadow: '0 1px 2px rgba(4,5,5,0.3)',
                }} />
            </span>
        </span>
    </span>
);

export default Switch;
