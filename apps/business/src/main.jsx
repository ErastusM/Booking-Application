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

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>
);
