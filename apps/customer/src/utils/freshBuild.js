// Long-lived tabs and installed PWAs keep running the bundle they booted with,
// so users can sit on a stale build for days after a deploy. On return-to-app
// (visibility/focus) we compare the entry bundle referenced by the server's
// index.html (served with no-store) against the one actually running and
// reload when they differ. No-ops in dev, where the module script is /src/main.jsx.
export const initFreshBuildReload = (skipPaths = []) => {
    const runningSrc = document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src');
    if (!runningSrc) return;
    const running = runningSrc.split('/').pop();
    let lastCheck = 0;

    const check = async () => {
        if (Date.now() - lastCheck < 5 * 60 * 1000) return;
        lastCheck = Date.now();
        try {
            const res = await fetch('/', { cache: 'no-store' });
            const html = await res.text();
            const next = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0].split('/').pop();
            if (!next || next === running) return;
            // Never yank the page out from under an in-progress flow.
            if (skipPaths.some(p => window.location.pathname.startsWith(p))) return;
            window.location.reload();
        } catch { /* offline — try again next time */ }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
    });
    window.addEventListener('focus', check);
};
