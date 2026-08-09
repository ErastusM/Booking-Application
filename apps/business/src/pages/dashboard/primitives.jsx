import React from 'react';
import { Phone, Mail, MessageSquare } from 'lucide-react';
import { useModalChrome } from '../../hooks/useModalChrome';

// Small, prop-driven presentational pieces shared across the provider dashboard.
// Extracted from ProviderDashboard.jsx (which was ~3.7k lines) — none of these
// touch the dashboard's internal state, so they live here as pure building blocks.

export const statusConfig = {
    pending: { label: 'Pending', bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: 'Confirmed', bg: '#dbeafe', color: '#1e40af' },
    completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#991b1b' },
    'no-show': { label: 'No-show', bg: '#ede9fe', color: '#5b21b6' },
};

// Quick-contact row reused by the appointment drawer and the client profile so a
// provider can call, email, or open an in-app chat with a client in one tap.
export const ContactActions = ({ phone, email, onMessage }) => {
    const btn = {
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
        padding: '0.55rem 0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
        background: 'var(--card-bg)', color: 'var(--charcoal)', fontSize: '0.8rem', fontWeight: 600,
        fontFamily: 'var(--font-body)', cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap',
    };
    const disabled = { ...btn, opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' };
    return (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
            <a href={phone ? `tel:${phone}` : undefined} style={phone ? btn : disabled} aria-label="Call client" title={phone || 'No phone on file'}>
                <Phone size={15} /> Call
            </a>
            <a href={email ? `mailto:${email}` : undefined} style={email ? btn : disabled} aria-label="Email client" title={email || 'No email on file'}>
                <Mail size={15} /> Email
            </a>
            <button type="button" onClick={onMessage} style={onMessage ? btn : disabled} aria-label="Message client">
                <MessageSquare size={15} /> Chat
            </button>
        </div>
    );
};

// Modal shell that wires in shared dialog chrome (Escape-to-close, body scroll
// lock, initial focus) via useModalChrome. Mounted only while its modal is open,
// so the hook's lifecycle matches the dialog. Renders a fade-in scrim + the panel
// (whose entrance animation comes from its own className, e.g. .appt-modal-pop or
// the .block-time-panel CSS). Children are the panel's contents.
export const ChromeModal = ({ onClose, panelClassName = '', panelStyle, scrimStyle, children }) => {
    const panelRef = useModalChrome(onClose);
    return (
        <>
            <div className="scrim-in" onClick={onClose} style={scrimStyle} />
            <div ref={panelRef} tabIndex={-1} className={panelClassName} style={{ ...panelStyle, outline: 'none' }}>
                {children}
            </div>
        </>
    );
};

// 44x44 flex-centered close control — keeps the glyph visually small while the
// hit area clears the touch-target minimum.
export const CloseButton = ({ onClick, dark = true }) => (
    <button
        type="button"
        onClick={onClick}
        aria-label="Close"
        style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1,
            color: dark ? 'rgba(255,255,255,0.5)' : 'var(--text-muted)',
            minWidth: '44px', minHeight: '44px', margin: '-0.5rem -0.5rem -0.5rem 0',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
    >&times;</button>
);

// Loading placeholder for the Earnings / Insights tabs — reserves the real
// KPI-grid + chart layout with shimmer blocks so content doesn't shove in.
export const StatsSkeleton = () => {
    const card = { background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem' };
    return (
        <div aria-hidden="true">
            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} style={{ ...card, display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div className="skeleton" style={{ width: '44px', height: '44px', borderRadius: '10px', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                            <div className="skeleton skeleton-line" style={{ width: '55%' }} />
                            <div className="skeleton skeleton-title" style={{ width: '70%', marginBottom: '8px' }} />
                            <div className="skeleton skeleton-line" style={{ width: '40%', marginBottom: 0 }} />
                        </div>
                    </div>
                ))}
            </div>
            <div className="provider-profile-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                {[0, 1].map((i) => (
                    <div key={i} style={{ ...card, padding: '1.5rem' }}>
                        <div className="skeleton skeleton-title" style={{ marginBottom: '1.25rem' }} />
                        <div className="skeleton" style={{ height: '140px', borderRadius: 'var(--radius-sm)' }} />
                    </div>
                ))}
            </div>
        </div>
    );
};

// Loading placeholder rows for the data tabs (clients / messages / packages /
// wallet / team) — grey shimmer lines sized to the real table/list rows.
export const RowsSkeleton = ({ rows = 6 }) => (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem 0' }}>
        {Array.from({ length: rows }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.75rem 0.25rem' }}>
                <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                    <div className="skeleton skeleton-line" style={{ width: '45%' }} />
                    <div className="skeleton skeleton-line" style={{ width: '30%', marginBottom: 0 }} />
                </div>
                <div className="skeleton" style={{ width: '64px', height: '20px', borderRadius: '99px', flexShrink: 0 }} />
            </div>
        ))}
    </div>
);

// Initials avatar + relative time for the iOS-style Messages list.
export const initialsOf = (name) => ((name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?');
export const Avatar = ({ name, size = 40 }) => (
    <div aria-hidden="true" style={{ flexShrink: 0, width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: size * 0.4, fontFamily: 'var(--font-body)' }}>
        {initialsOf(name)}
    </div>
);
export const fmtConvTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
