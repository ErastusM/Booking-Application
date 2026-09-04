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
initFreshBuildReload(['/book-appointment']);

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
// First-ever open: a full 2s — long enough to read the taglines as a deliberate
// brand moment AND to let the home render/fetch behind it. Every launch after
// that, index.html's inline script already dropped the taglines (logo only, see
// data-repeat-launch), so a brief hold is enough — just settle the home behind it.
const __splash = document.getElementById('app-splash');
if (__splash) {
    const __repeatLaunch = document.documentElement.getAttribute('data-repeat-launch') === 'true';
    // The app is already rendered behind the splash, so a fixed hold is pure dead
    // time on every open. Hide it as soon as the app has painted on a repeat
    // launch; keep only a brief first-install brand flash. (The 8s backstop above
    // still covers a stalled boot.)
    const __holdMs = __repeatLaunch ? 0 : 600;
    window.setTimeout(() => {
        __splash.classList.add('app-splash--hidden');
        window.setTimeout(() => __splash.remove(), 500);
    }, __holdMs);
}
