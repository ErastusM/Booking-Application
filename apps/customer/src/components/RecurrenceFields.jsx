import React, { useState } from 'react';
import MiniCalendar from './MiniCalendar';

// Shared recurring-booking controls: frequency presets plus a fully-custom
// "every N days/weeks/months", with the end date chosen on the same calendar
// used across the app. Used by both the client booking page and the provider
// New Appointment modal so the experience is identical.
const pill = (active) => ({
    padding: '0.45rem 0.95rem', borderRadius: '99px', cursor: 'pointer', fontFamily: 'var(--font-body)',
    fontSize: '0.82rem', fontWeight: active ? '600' : '500',
    border: `1.5px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
    background: active ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)',
    color: active ? 'var(--gold-dark)' : 'var(--text-secondary)',
});

const RecurrenceFields = ({ value, onChange, minDate }) => {
    const { isRecurring, recurrenceType = 'weekly', recurrenceInterval = 1, recurrenceEndDate = '' } = value;
    const [custom, setCustom] = useState((recurrenceInterval || 1) > 1);
    const set = (patch) => onChange({ ...value, ...patch });
    const plural = recurrenceInterval > 1 ? 's' : '';

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                    <p style={{ margin: 0, fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>Repeat this appointment</p>
                    <p style={{ margin: '0.1rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Book it as a recurring series</p>
                </div>
                <button type="button" aria-pressed={isRecurring} onClick={() => set({ isRecurring: !isRecurring })} style={{ width: '46px', height: '26px', borderRadius: '99px', border: 'none', cursor: 'pointer', background: isRecurring ? 'var(--gold)' : '#d1d5db', position: 'relative', flexShrink: 0 }}>
                    <span style={{ position: 'absolute', top: '3px', left: isRecurring ? '23px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
                </button>
            </div>

            {isRecurring && (
                <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, label]) => (
                            <button key={v} type="button" onClick={() => { setCustom(false); set({ recurrenceType: v, recurrenceInterval: 1 }); }} style={pill(!custom && recurrenceType === v)}>{label}</button>
                        ))}
                        <button type="button" onClick={() => { setCustom(true); set({ recurrenceInterval: Math.max(2, recurrenceInterval || 2) }); }} style={pill(custom)}>Custom</button>
                    </div>

                    {custom && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>Repeat every</span>
                            <input type="number" min="1" max="52" value={recurrenceInterval}
                                onChange={(e) => set({ recurrenceInterval: Math.min(52, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                                className="input" style={{ width: '72px', textAlign: 'center' }} />
                            <select value={recurrenceType} onChange={(e) => set({ recurrenceType: e.target.value })} className="input" style={{ width: 'auto' }}>
                                <option value="daily">day{plural}</option>
                                <option value="weekly">week{plural}</option>
                                <option value="monthly">month{plural}</option>
                            </select>
                        </div>
                    )}

                    <div>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                            Ends on <span style={{ fontWeight: '400', textTransform: 'none' }}>(optional — defaults to 3 months)</span>
                        </label>
                        <MiniCalendar value={recurrenceEndDate} onChange={(ds) => set({ recurrenceEndDate: ds })} min={minDate} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default RecurrenceFields;
