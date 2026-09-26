import React, { useState } from 'react';
import { authService } from '../services';

// "Your data": a copy of everything Bookplus holds about this account, as a
// JSON file (profile, bookings, reviews, wallet, messages sent, consents…).
const YourDataCard = ({ note }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const download = async () => {
        setBusy(true); setError('');
        try {
            const res = await authService.exportAccount();
            const blob = res.data instanceof Blob ? res.data : new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bookplus-my-data-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
            setError('Could not prepare your data. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.25rem 1.5rem', marginTop: '1.5rem' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', margin: '0 0 0.5rem' }}>Your data</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 0.9rem', lineHeight: 1.55 }}>
                Download a copy of everything we hold about your account — profile, bookings, reviews, wallet transactions, messages you sent and your consents — as a JSON file.
                {note ? ` ${note}` : ''}
            </p>
            <button type="button" className="btn-outline" onClick={download} disabled={busy} data-testid="download-my-data" style={{ padding: '0.55rem 1.1rem', fontSize: '0.85rem' }}>
                {busy ? 'Preparing…' : 'Download my data'}
            </button>
            {error && <p role="alert" style={{ color: 'var(--danger-fg)', fontSize: '0.82rem', margin: '0.6rem 0 0' }}>{error}</p>}
        </div>
    );
};

export default YourDataCard;
