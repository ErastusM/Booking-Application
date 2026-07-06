import { useEffect, useRef } from 'react';

// Lightweight "live updates" without websockets: re-runs `onRefresh` on an
// interval while the tab is visible, and immediately when the tab regains focus
// or visibility. Pauses while the tab is hidden to avoid wasted requests.
//
//   useLiveRefresh(() => refetch(), { intervalMs: 25000, enabled: true });
export const useLiveRefresh = (onRefresh, { intervalMs = 30000, enabled = true } = {}) => {
    const saved = useRef(onRefresh);
    useEffect(() => { saved.current = onRefresh; });

    useEffect(() => {
        if (!enabled) return undefined;
        let timer = null;
        const run = () => { if (document.visibilityState === 'visible') saved.current && saved.current(); };
        const start = () => { if (!timer) timer = setInterval(run, intervalMs); };
        const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') { run(); start(); }
            else stop();
        };
        start();
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', run);
        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('focus', run);
        };
    }, [intervalMs, enabled]);
};

export default useLiveRefresh;
