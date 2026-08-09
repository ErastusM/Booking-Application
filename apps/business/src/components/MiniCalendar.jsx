import React, { useState } from 'react';

// App-consistent month-grid date picker (mirrors the BookAppointment calendar),
// used anywhere we'd otherwise drop a native <input type="date">.
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => { if (!s) return null; const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };

const MiniCalendar = ({ value, onChange, min, max }) => {
    const selected = parse(value);
    const minD = parse(min);
    const maxD = parse(max);
    const [month, setMonth] = useState(() => {
        const base = selected || minD || new Date();
        return new Date(base.getFullYear(), base.getMonth(), 1);
    });

    const year = month.getFullYear();
    const mo = month.getMonth();
    const firstDay = new Date(year, mo, 1).getDay();
    const daysInMonth = new Date(year, mo + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, mo, d));

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const isDisabled = (d) => (minD && d < minD) || (maxD && d > maxD);
    const navBtn = { background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', width: '40px', height: '40px', cursor: 'pointer', color: 'var(--charcoal)' };

    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.85rem', background: 'var(--card-bg)', maxWidth: '320px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <button type="button" aria-label="Previous month" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} style={navBtn}>←</button>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: '600', fontSize: '0.95rem', color: 'var(--charcoal)' }}>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
                <button type="button" aria-label="Next month" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} style={navBtn}>→</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px', marginBottom: '3px' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                    <div key={i} style={{ textAlign: 'center', fontSize: '0.6rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', padding: '2px 0' }}>{d.slice(0, 1)}</div>
                ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
                {cells.map((d, i) => {
                    if (!d) return <div key={i} />;
                    const ds = fmt(d);
                    const disabled = isDisabled(d);
                    const isSel = value === ds;
                    const isToday = ds === fmt(today);
                    return (
                        <button
                            key={i}
                            type="button"
                            disabled={disabled}
                            onClick={() => !disabled && onChange(ds)}
                            style={{
                                aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: `1.5px solid ${isSel ? 'var(--gold)' : 'transparent'}`, borderRadius: '8px',
                                background: isSel ? 'var(--gold)' : isToday ? 'var(--surface-sunken)' : 'transparent',
                                color: disabled ? 'var(--text-muted)' : isSel ? 'var(--ink)' : 'var(--charcoal)',
                                opacity: disabled ? 0.3 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
                                fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: isSel || isToday ? '700' : '500',
                            }}
                        >{d.getDate()}</button>
                    );
                })}
            </div>
        </div>
    );
};

export default MiniCalendar;
