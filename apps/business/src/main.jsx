import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted variable fonts (no runtime Google-Fonts dependency):
// Plus Jakarta Sans for display/headings, Inter for body/UI text.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/inter';
import '@bookplus/design-tokens/tokens.css';
import './styles/index.css';
import App from './App';
import { initNative } from './native';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

// Native-shell setup (status bar, splash, back button) — no-op on the web.
initNative();
