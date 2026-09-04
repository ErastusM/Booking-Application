import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted variable fonts (no runtime Google-Fonts dependency):
// Plus Jakarta Sans for display/headings, Inter for body/UI text.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/inter';
import '@bookplus/design-tokens/tokens.css';
import './styles/index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initFreshBuildReload } from './utils/freshBuild';
import { initErrorReporter } from './utils/errorReporter';

// Capture uncaught JS errors + unhandled promise rejections (production only).
initErrorReporter();

// Reload long-lived tabs/PWAs onto the newest build when the user returns.
initFreshBuildReload([]);

// Backstop: armed BEFORE render so the opaque splash can never trap the UI, even
// if render() throws synchronously. The normal, prettier fade runs below on success.
window.setTimeout(() => document.getElementById('app-splash')?.remove(), 8000);

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>
);

// Hold the boot splash after paint, then fade (0.45s CSS transition) and remove.
// First-EVER open: a full 2s hold, long enough to read the tagline as a
// deliberate brand moment AND to let the dashboard render/fetch behind it, so
// the app is settled when the splash lifts. Every launch after (the inline
// boot script in index.html already stamped `data-splash="brief"` and hid the
// tagline/hero copy before first paint): just a brief logo flash.
const __splash = document.getElementById('app-splash');
if (__splash) {
    const __briefSplash = document.documentElement.getAttribute('data-splash') === 'brief';
    // The dashboard is already rendered behind the splash; a fixed hold is dead
    // time on every open. Hide immediately on a repeat launch, keep a brief flash
    // on first install only. (The 8s backstop above still covers a stalled boot.)
    window.setTimeout(() => {
        __splash.classList.add('app-splash--hidden');
        window.setTimeout(() => __splash.remove(), 500);
    }, __briefSplash ? 0 : 600);
}
