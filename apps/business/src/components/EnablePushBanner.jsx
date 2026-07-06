import React, { useEffect, useState } from 'react';
import { getPushState, enablePush } from '../utils/push';
import { useAuthContext } from '../context/AuthContext';

const DISMISS_KEY = 'bp_push_prompt_dismissed';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '');
const isStandalone = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

// Prompts a signed-in user to turn on push so booking alerts reach their lock screen.
// Two modes: an in-browser "Turn on" (one tap → enablePush), or — on iPhone, where Apple
// only allows web push for installed PWAs — an "Add to Home Screen" hint.
const EnablePushBanner = () => {
    const { user } = useAuthContext();
    const [mode, setMode] = useState(null); // 'enable' | 'ios' | null
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!user) { setMode(null); return; }
        if (localStorage.getItem(DISMISS_KEY) === '1') return;
        let cancelled = false;
        (async () => {
            // iPhone in Safari (not installed) can't subscribe to web push — show the install hint.
            if (isIOS() && !isStandalone()) { if (!cancelled) setMode('ios'); return; }
            try {
                const s = await getPushState();
                if (!cancelled && s.supported && s.enabled && !s.subscribed) setMode('enable');
            } catch { /* ignore */ }
        })();
        return () => { cancelled = true; };
    }, [user]);

    if (!mode) return null;

    const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } setMode(null); };
    const turnOn = async () => {
        setBusy(true);
        try { await enablePush(); setMode(null); }
        catch { /* permission denied / failed — leave the banner so they can retry */ }
        finally { setBusy(false); }
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', background: 'rgba(240,62,22,0.1)', border: '1px solid rgba(240,62,22,0.32)', borderRadius: 'var(--radius)', padding: '0.85rem 1rem', marginBottom: '1.5rem' }}>
            <span style={{ fontSize: '1.3rem', flexShrink: 0 }} aria-hidden="true">🔔</span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: '700', color: 'var(--charcoal)', fontSize: '0.92rem' }}>
                    {mode === 'ios' ? 'Get booking alerts on your lock screen' : 'Never miss a booking'}
                </p>
                <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                    {mode === 'ios'
                        ? 'Tap Share → “Add to Home Screen”, then open Bookplus from there to turn on notifications.'
                        : 'Turn on push notifications and we’ll ping you the moment a booking comes in.'}
                </p>
            </div>
            {mode === 'enable' && (
                <button onClick={turnOn} disabled={busy} className="btn-primary" style={{ padding: '0.5rem 1.1rem', fontSize: '0.85rem', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {busy ? 'Turning on…' : 'Turn on'}
                </button>
            )}
            <button onClick={dismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.25rem', lineHeight: 1, padding: '0 0.25rem', flexShrink: 0 }}>×</button>
        </div>
    );
};

export default EnablePushBanner;
