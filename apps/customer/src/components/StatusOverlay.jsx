import React, { useEffect, useRef } from 'react';

// Full-screen celebratory / acknowledgement moment shown after a booking is
// confirmed or cancelled. A soft radial gradient, an SVG checkmark that draws
// itself in, and a display-font headline. Auto-dismisses after `duration`
// (tap anywhere to skip). Reduced-motion users get the same screen without the
// draw animation (the global prefers-reduced-motion rule zeroes it out).
const VARIANTS = {
    // Warm brand-orange radial → celebratory.
    confirmed: 'radial-gradient(circle at 50% 38%, #ff7a4d 0%, #f03e16 46%, #b8280a 100%)',
    // Muted ink radial → a calm "done", not a celebration and not an error-red.
    cancelled: 'radial-gradient(circle at 50% 38%, #33343a 0%, #16171a 52%, #050506 100%)',
};

const StatusOverlay = ({ variant = 'confirmed', title, subtitle, onDone, duration = 2200 }) => {
    const doneRef = useRef(onDone);
    doneRef.current = onDone;
    const firedRef = useRef(false);

    const finish = () => { if (firedRef.current) return; firedRef.current = true; doneRef.current?.(); };

    useEffect(() => {
        const t = setTimeout(finish, duration);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div
            role="status"
            aria-live="polite"
            onClick={finish}
            style={{
                position: 'fixed', inset: 0, zIndex: 5000, background: VARIANTS[variant] || VARIANTS.confirmed,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '2rem', textAlign: 'center', cursor: 'pointer',
                paddingTop: 'calc(2rem + env(safe-area-inset-top, 0px))',
                animation: 'statusOverlayIn 0.28s ease',
            }}
        >
            <svg viewBox="0 0 52 52" width="92" height="92" aria-hidden="true" style={{ marginBottom: '1.6rem' }}>
                <circle className="so-circle" cx="26" cy="26" r="24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
                <path className="so-check" d="M15 27 l7.5 7.5 L38 19" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2 className="so-title" style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 'clamp(1.7rem, 6vw, 2.4rem)', fontWeight: 600, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.1 }}>
                {title}
            </h2>
            {subtitle && (
                <p className="so-sub" style={{ color: 'rgba(255,255,255,0.85)', fontSize: '1rem', margin: '0.7rem 0 0', maxWidth: '30ch', lineHeight: 1.5 }}>
                    {subtitle}
                </p>
            )}
            <style>{`
                @keyframes statusOverlayIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes soDraw { to { stroke-dashoffset: 0; } }
                @keyframes soRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                .so-circle { stroke-dasharray: 151; stroke-dashoffset: 151; animation: soDraw 0.5s cubic-bezier(0.65,0,0.35,1) forwards; }
                .so-check { stroke-dasharray: 44; stroke-dashoffset: 44; animation: soDraw 0.32s 0.42s cubic-bezier(0.65,0,0.35,1) forwards; }
                .so-title { animation: soRise 0.4s 0.5s both; }
                .so-sub { animation: soRise 0.4s 0.62s both; }
                @media (prefers-reduced-motion: reduce) {
                    .so-circle, .so-check { animation: none; stroke-dashoffset: 0; }
                    .so-title, .so-sub { animation: none; }
                }
            `}</style>
        </div>
    );
};

export default StatusOverlay;
