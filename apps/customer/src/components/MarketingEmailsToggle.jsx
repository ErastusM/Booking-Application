import React, { useEffect, useState } from 'react';
import { authService } from '../services';

// Account-settings switch for promotional email ("Book again" reminders and
// offers). Off unless the person turned it on; booking emails are unaffected.
const MarketingEmailsToggle = () => {
    const [optIn, setOptIn] = useState(null); // null = loading
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        authService.getProfile()
            .then((r) => setOptIn(r.data?.data?.marketingEmails?.optIn === true))
            .catch(() => setOptIn(false));
    }, []);

    const toggle = async () => {
        const next = !optIn;
        setBusy(true); setError('');
        try { await authService.setMarketingEmails(next); setOptIn(next); }
        catch (e) { setError(e.response?.data?.message || 'Could not update your email preference'); }
        finally { setBusy(false); }
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '1rem 0' }}>
            <div>
                <p id="marketing-emails-label" style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>Offers &amp; rebooking reminders by email</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>Occasional “Book again” reminders and offers. Emails about your bookings always arrive.</p>
                {error && <p role="alert" style={{ fontSize: '0.75rem', color: '#dc2626', margin: '0.3rem 0 0' }}>{error}</p>}
            </div>
            <button
                type="button" role="switch" aria-checked={optIn === true} aria-labelledby="marketing-emails-label"
                data-testid="marketing-emails-toggle"
                onClick={toggle} disabled={busy || optIn === null}
                style={{ width: '46px', height: '26px', borderRadius: '99px', border: 'none', flexShrink: 0, background: optIn ? 'var(--gold)' : 'var(--warm-gray)', cursor: busy ? 'wait' : 'pointer', position: 'relative', transition: 'background 0.2s' }}
            >
                <span style={{ position: 'absolute', top: '3px', left: optIn ? '23px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
            </button>
        </div>
    );
};

export default MarketingEmailsToggle;
