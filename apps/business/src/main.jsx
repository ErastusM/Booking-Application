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

// Fade out the boot splash once the app has painted (min ~650ms so it reads as a
// deliberate brand moment, not a flash). Removed after the transition.
const __splash = document.getElementById('app-splash');
if (__splash) {
    window.setTimeout(() => {
        __splash.classList.add('app-splash--hidden');
        window.setTimeout(() => __splash.remove(), 500);
    }, 650);
}
