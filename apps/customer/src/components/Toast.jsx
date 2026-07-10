import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// Lightweight, non-blocking toast to replace window.alert(). Toasts announce
// via aria-live (polite) without stealing focus and auto-dismiss. Call
// useToast() to get a `toast(message, type)` fn — type: 'success'|'error'|'info'.
const ToastContext = createContext(() => {});

export const useToast = () => useContext(ToastContext);

const TONE = {
    success: { bg: 'var(--ink)', accent: '#4ade80' },
    error:   { bg: 'var(--ink)', accent: '#f87171' },
    info:    { bg: 'var(--ink)', accent: 'var(--gold)' },
};

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);
    const idRef = useRef(0);

    const toast = useCallback((message, type = 'info', ms = 3800) => {
        if (!message) return;
        const id = ++idRef.current;
        setToasts((t) => [...t, { id, message, type }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
    }, []);

    return (
        <ToastContext.Provider value={toast}>
            {children}
            <div
                aria-live="polite"
                aria-atomic="false"
                style={{
                    position: 'fixed', left: '50%', transform: 'translateX(-50%)',
                    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
                    zIndex: 3000, display: 'flex', flexDirection: 'column', gap: '0.5rem',
                    width: 'min(92vw, 420px)', pointerEvents: 'none',
                }}
            >
                {toasts.map((t) => {
                    const tone = TONE[t.type] || TONE.info;
                    return (
                        <div key={t.id} role="status" className="scale-in" style={{
                            pointerEvents: 'auto', background: tone.bg, color: 'var(--on-ink)',
                            borderLeft: `3px solid ${tone.accent}`, borderRadius: '12px',
                            padding: '0.8rem 1rem', fontSize: '0.9rem', fontWeight: 600,
                            fontFamily: 'var(--font-body)', boxShadow: '0 10px 30px rgba(4,5,5,0.28)',
                            lineHeight: 1.4,
                        }}>
                            {t.message}
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
};
