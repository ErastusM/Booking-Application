import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
    const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

    useEffect(() => {
        document.body.classList.toggle('dark-mode', darkMode);
        localStorage.setItem('darkMode', String(darkMode));
        // Keep the browser / Android-PWA chrome (status bar tint) in sync with the in-app
        // theme. iOS standalone ignores this for its status bar — that case is handled by
        // the dark safe-area backdrop in the navbar — but this fixes everywhere else.
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', darkMode ? '#0f0f1a' : '#ffffff');
    }, [darkMode]);

    const toggleDarkMode = () => setDarkMode(prev => !prev);

    return (
        <ThemeContext.Provider value={{ darkMode, toggleDarkMode }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
