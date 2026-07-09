import React, { useEffect, useState } from 'react';

// The build id baked into this bundle (Vite `define` in the shared vite preset).
const CURRENT = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '';

/**
 * Auto-update: polls /version.json (rewritten on every deploy). When the
 * deployed build id differs from the one running, a newer version has shipped —
 * show a brief "Updating…" screen and hard-reload, so users always get the
 * latest without being asked to refresh. No-ops in dev (no version.json).
 */
const AppUpdater = () => {
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        if (!CURRENT) return;
        let stopped = false;

        const check = async () => {
            if (stopped || document.hidden) return;
            try {
                const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
                if (!res.ok) return;
                const data = await res.json();
                if (data.buildId && data.buildId !== CURRENT) {
                    stopped = true;
                    setUpdating(true);
                    setTimeout(() => window.location.reload(), 900);
                }
            } catch { /* offline / transient — ignore */ }
        };

        const interval = setInterval(check, 60_000);
        const onWake = () => check();
        window.addEventListener('focus', onWake);
        document.addEventListener('visibilitychange', onWake);
        check(); // once on mount

        return () => {
            stopped = true;
            clearInterval(interval);
            window.removeEventListener('focus', onWake);
            document.removeEventListener('visibilitychange', onWake);
        };
    }, []);

    if (!updating) return null;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'var(--off-white)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.1rem', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div style={{ width: '44px', height: '44px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'bp-spin 0.8s linear infinite' }} />
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700, color: 'var(--charcoal)', margin: 0 }}>Updating…</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Getting the latest version</p>
            <style>{`@keyframes bp-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default AppUpdater;
