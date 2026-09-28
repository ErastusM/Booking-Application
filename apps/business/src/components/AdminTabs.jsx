import React, { useCallback, useEffect, useRef, useState } from 'react';

// The admin console's tab row. On a phone the five tabs don't fit, and the row
// used to just cut off at "Revenue" with nothing saying there was more. It now
// scrolls sideways with a fade (and a chevron) on whichever edge has more
// tabs, and the chosen tab is scrolled fully into view.
const AdminTabs = ({ tabs, active, onChange }) => {
    const rowRef = useRef(null);
    const [edges, setEdges] = useState({ left: false, right: false });

    const measure = useCallback(() => {
        const el = rowRef.current;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        setEdges({ left: el.scrollLeft > 2, right: max - el.scrollLeft > 2 });
    }, []);

    useEffect(() => {
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [measure, tabs.length]);

    useEffect(() => {
        // Horizontal only — scrollIntoView could also move the page itself.
        const row = rowRef.current;
        const btn = row?.querySelector('[aria-selected="true"]');
        if (!row || !btn) return;
        const pad = 40; // clear of the fade
        const left = btn.offsetLeft - row.offsetLeft;
        if (left < row.scrollLeft + pad) row.scrollLeft = Math.max(0, left - pad);
        else if (left + btn.offsetWidth > row.scrollLeft + row.clientWidth - pad) row.scrollLeft = left + btn.offsetWidth - row.clientWidth + pad;
        measure();
    }, [active, measure]);

    const fade = (side) => ({
        position: 'absolute', top: 0, bottom: '1px', [side]: 0, width: '2.75rem', pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: side === 'right' ? 'flex-end' : 'flex-start',
        background: `linear-gradient(to ${side === 'right' ? 'left' : 'right'}, var(--off-white) 35%, transparent)`,
        color: 'var(--text-muted)', fontSize: '1.1rem', fontWeight: 600,
    });

    return (
        <div style={{ position: 'relative', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
            <div
                ref={rowRef}
                role="tablist"
                aria-label="Admin sections"
                data-testid="admin-tabs"
                onScroll={measure}
                style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.35rem', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
            >
                {tabs.map((tab) => {
                    const on = active === tab;
                    return (
                        <button key={tab} role="tab" aria-selected={on} onClick={() => onChange(tab)} style={{
                            padding: '0.65rem 1rem', background: on ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)', border: '1px solid',
                            borderColor: on ? 'var(--gold)' : 'var(--border)',
                            borderRadius: '999px',
                            color: on ? 'var(--gold-dark)' : 'var(--text-secondary)',
                            fontWeight: on ? '600' : '500', fontSize: '0.85rem',
                            cursor: 'pointer', fontFamily: 'var(--font-body)',
                            transition: 'all 0.2s', whiteSpace: 'nowrap', flexShrink: 0,
                        }}>
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    );
                })}
            </div>
            {edges.left && <div aria-hidden="true" data-testid="admin-tabs-fade-left" style={fade('left')}>‹</div>}
            {edges.right && <div aria-hidden="true" data-testid="admin-tabs-fade-right" style={fade('right')}>›</div>}
        </div>
    );
};

export default AdminTabs;
