import React from 'react';

// One consent tick-box, label linked to its input. Always starts UNTICKED —
// consent is something a person gives, never a default.
const ConsentCheckbox = ({ id, checked, onChange, children, testId }) => (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
        <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            data-testid={testId}
            style={{ marginTop: '0.15rem', width: '16px', height: '16px', flexShrink: 0, accentColor: 'var(--gold)', cursor: 'pointer' }}
        />
        <span>{children}</span>
    </label>
);

// The marketing opt-in copy, shared by sign-up and the guest booking form.
export const MARKETING_OPT_IN_TEXT = 'Email me rebooking reminders and offers from Bookplus (optional). Unsubscribe any time with one click.';

export default ConsentCheckbox;
