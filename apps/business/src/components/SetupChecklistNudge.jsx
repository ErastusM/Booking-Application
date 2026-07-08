import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { providerServiceService } from '../services';
import { useAuthContext } from '../context/AuthContext';

const DISMISS_KEY = 'bp_setup_nudge_dismissed';

// Each onboarding piece → where the provider finishes it. Derived live from the
// setup-status endpoint, so it stays truthful even if a step is completed
// outside the onboarding flow (or the flow was skipped).
const ITEMS = [
    { key: 'address', label: 'Add your location', to: '/account' },
    { key: 'hours', label: 'Set your working hours', to: '/dashboard?tab=availability' },
    { key: 'services', label: 'Add your services', to: '/dashboard?tab=services' },
    { key: 'photos', label: 'Add photos', to: '/account' },
];

// Dashboard reminder: nudges a provider to finish any onboarding step they
// skipped. Hidden once everything is done or the card is dismissed.
const SetupChecklistNudge = () => {
    const { user } = useAuthContext();
    const [status, setStatus] = useState(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (user?.role !== 'provider') return;
        if (localStorage.getItem(DISMISS_KEY) === '1') { setDismissed(true); return; }
        let cancelled = false;
        providerServiceService.getSetupStatus()
            .then((r) => { if (!cancelled) setStatus(r.data.data); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [user]);

    if (dismissed || !status || status.complete) return null;

    const remaining = ITEMS.filter((it) => !status[it.key]);
    if (remaining.length === 0) return null;
    const done = ITEMS.length - remaining.length;

    const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } setDismissed(true); };

    return (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderLeft: '3px solid var(--gold)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '1.1rem 1.25rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 700, color: 'var(--charcoal)', fontSize: '0.95rem' }}>Finish setting up your business</p>
                    <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                        {done} of {ITEMS.length} done — complete the rest so clients can find and book you.
                    </p>
                </div>
                <button onClick={dismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.25rem', lineHeight: 1, padding: '0 0.25rem', flexShrink: 0 }}>×</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.9rem' }}>
                {remaining.map((it) => (
                    <Link key={it.key} to={it.to} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.85rem', borderRadius: '999px', border: '1.5px solid var(--gold)', background: 'rgba(240,62,22,0.08)', color: 'var(--gold-dark)', fontSize: '0.82rem', fontWeight: 600, textDecoration: 'none' }}>
                        {it.label} →
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default SetupChecklistNudge;
