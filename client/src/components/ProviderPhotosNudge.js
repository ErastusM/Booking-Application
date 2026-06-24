import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';

const DISMISS_KEY = 'bp_photos_nudge_dismissed';

// Nudge a provider with an empty portfolio to add photos — those photos are exactly what
// show on the home feed and the profile gallery, so an empty gallery means fewer bookings.
const ProviderPhotosNudge = () => {
    const { user, activeRole } = useAuthContext();
    const [show, setShow] = useState(false);

    useEffect(() => {
        if (user?.role !== 'provider' || activeRole !== 'provider') { setShow(false); return; }
        if (localStorage.getItem(DISMISS_KEY) === '1') return;
        let cancelled = false;
        authService.getProfile()
            .then(res => {
                const imgs = res.data?.data?.portfolio?.images || [];
                if (!cancelled && imgs.length === 0) setShow(true);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [user, activeRole]);

    if (!show) return null;

    const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } setShow(false); };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderLeft: '3px solid var(--gold)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '0.95rem 1.1rem', marginBottom: '1.5rem' }}>
            <span style={{ fontSize: '1.3rem', flexShrink: 0 }} aria-hidden="true">📸</span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: '700', color: 'var(--charcoal)', fontSize: '0.92rem' }}>Add photos to win more bookings</p>
                <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                    Your photos are the first thing customers see on the home feed. Listings with photos get noticed far more.
                </p>
            </div>
            <Link to="/account" className="btn-primary" style={{ padding: '0.5rem 1.1rem', fontSize: '0.85rem', flexShrink: 0, whiteSpace: 'nowrap', textDecoration: 'none' }}>
                Add photos
            </Link>
            <button onClick={dismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.25rem', lineHeight: 1, padding: '0 0.25rem', flexShrink: 0 }}>×</button>
        </div>
    );
};

export default ProviderPhotosNudge;
