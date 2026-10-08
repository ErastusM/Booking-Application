import { useId, useMemo, useState } from 'react';

// "New client" while booking (New Appointment): someone who isn't on the
// business's list yet. Full name and phone are required, email is optional.
// Nothing is saved here: the details travel with the booking, which files the
// client under My Clients (see utils/bookingClient.js and the API's
// newClientContact). If the phone already belongs to a saved client, it says so
// and offers to book that client instead, so the list doesn't fill with
// duplicates.

export const COUNTRY_CODE = '+264';

const digitsOf = (s) => String(s || '').replace(/\D/g, '');

// The last 9 digits identify a Namibian number whichever way it was written
// (081 630 6705, +264 81 630 6705, 264816306705).
export const phoneKey = (s) => {
    const d = digitsOf(s);
    return d.length >= 7 ? d.slice(-9) : '';
};

// What the client types after the +264 box. A full international number they
// paste (+27…, 00264…) is kept as written; a local 0 is dropped.
export const fullPhone = (local) => {
    const raw = String(local || '').trim();
    if (!raw) return '';
    if (raw.startsWith('+')) return raw;
    if (raw.startsWith('00')) return `+${raw.slice(2)}`;
    return `${COUNTRY_CODE} ${raw.replace(/^0+/, '')}`;
};

export const isFullName = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).length >= 2;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const label = { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' };

export default function NewClientForm({ initial = {}, clients = [], onBack, onSave, onPickExisting, testId = 'new-client' }) {
    const id = useId();
    const [name, setName] = useState(initial.name || '');
    const [local, setLocal] = useState(() => {
        const p = String(initial.phone || '');
        return p.startsWith(`${COUNTRY_CODE} `) ? p.slice(COUNTRY_CODE.length + 1) : p;
    });
    const [email, setEmail] = useState(initial.email || '');
    const [error, setError] = useState('');

    // A saved client (account or past walk-in) who already has this number.
    const match = useMemo(() => {
        const key = phoneKey(local);
        if (!key) return null;
        return (clients || []).find((c) => phoneKey(c?.customer?.phone) === key) || null;
    }, [local, clients]);

    const save = () => {
        const n = name.trim().replace(/\s+/g, ' ');
        const phone = fullPhone(local);
        const mail = email.trim();
        if (!isFullName(n)) return setError('Please enter their first name and surname.');
        if (digitsOf(phone).length < 7) return setError('Please enter their phone number.');
        if (mail && !EMAIL_RE.test(mail)) return setError('Please enter a valid email address, or leave it empty.');
        setError('');
        onSave({ name: n, phone, email: mail || '' });
    };

    return (
        <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <button type="button" onClick={onBack} data-testid={`${testId}-back`}
                style={{ alignSelf: 'flex-start', minHeight: '44px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.9rem', fontFamily: 'var(--font-body)' }}>
                ← Back to clients
            </button>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600, color: 'var(--charcoal)', margin: '-0.4rem 0 0' }}>New client</h3>
            <label style={label}>
                Full name
                <input className="input" type="text" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)}
                    aria-required="true" data-testid={`${testId}-name`} style={{ width: '100%' }} />
            </label>
            <div style={label}>
                <label htmlFor={`${id}-phone`}>Phone</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', padding: '0 0.75rem', border: '1px solid var(--border-input)', borderRadius: 'var(--radius-sm)', color: 'var(--charcoal)', fontWeight: 500 }}>{COUNTRY_CODE}</span>
                    <input id={`${id}-phone`} className="input" type="tel" inputMode="tel" autoComplete="off" value={local}
                        onChange={(e) => setLocal(e.target.value)} aria-required="true" aria-describedby={match ? `${id}-dup` : undefined}
                        aria-label={`Phone, after ${COUNTRY_CODE}`} data-testid={`${testId}-phone`} style={{ flex: 1, minWidth: 0 }} />
                </div>
            </div>
            {match ? (
                <div id={`${id}-dup`} role="status" data-testid={`${testId}-duplicate`}
                    style={{ marginTop: '-0.35rem', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)', background: '#fdf0dc', color: '#6b3a05', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
                    <span>This number is already saved for <strong>{match.customer.name}</strong>.</span>
                    <button type="button" onClick={() => onPickExisting(match)} data-testid={`${testId}-book-existing`}
                        style={{ minHeight: '44px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#6b3a05', fontWeight: 700, textDecoration: 'underline', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)', fontSize: '0.82rem' }}>
                        Book {match.customer.name.split(' ')[0]}
                    </button>
                </div>
            ) : null}
            <label style={label}>
                <span>Email <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></span>
                <input className="input" type="email" inputMode="email" autoComplete="off" value={email}
                    placeholder="For confirmations and reminders" onChange={(e) => setEmail(e.target.value)}
                    data-testid={`${testId}-email`} style={{ width: '100%' }} />
            </label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                They'll be saved to My Clients, so next time you'll find them under Existing client.
            </p>
            {error ? <p role="alert" data-testid={`${testId}-error`} style={{ fontSize: '0.8rem', color: 'var(--danger-fg)', margin: 0 }}>{error}</p> : null}
            <button type="button" className="btn-primary" onClick={save} data-testid={`${testId}-save`} style={{ minHeight: '48px' }}>
                Save and continue
            </button>
        </div>
    );
}

// The chosen new client, before the booking is made (the "Saved and picked"
// screen): their initials, name, phone, a New tag and a Change button.
export function NewClientCard({ client, onChange, testId = 'new-client-card' }) {
    const initials = client.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    return (
        <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', border: '1.5px solid var(--gold)', borderRadius: 'var(--radius)', padding: '0.75rem 0.85rem', background: 'rgba(240,62,22,0.05)' }}>
                <span aria-hidden="true" className="cp-initials" style={{ width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0 }}>{initials}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, color: 'var(--charcoal)' }}>{client.name}</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{client.phone}</span>
                    {' '}
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, background: '#e1f3e8', color: '#1e5c3a', borderRadius: '99px', padding: '1px 8px' }}>New</span>
                </span>
                <button type="button" className="btn-outline" onClick={onChange} data-testid={`${testId}-change`} style={{ minHeight: '40px', padding: '0 0.75rem' }}>Change</button>
            </div>
            <p role="status" style={{ fontSize: '0.8rem', color: '#1e5c3a', margin: 0 }}>Saved to My Clients when you book</p>
        </div>
    );
}
