import React, { useId, useState } from 'react';
import MiniCalendar from './MiniCalendar';
import { Select } from '@bookplus/ui';

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
    const uid = useId();
    const titleId = `${uid}-title`, hintId = `${uid}-hint`, endsId = `${uid}-ends`, everyId = `${uid}-every`;

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                    <p id={titleId} style={{ margin: 0, fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>Repeat this appointment</p>
                    <p id={hintId} style={{ margin: '0.1rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Book it as a recurring series</p>
                </div>
                {/* A real switch (WCAG 4.1.2): role, on/off state and a name. The off
                    track is --border-input so the control holds 3:1 (1.4.11). */}
                <button type="button" role="switch" aria-checked={!!isRecurring} aria-labelledby={titleId} aria-describedby={hintId}
                    data-testid="recurrence-toggle"
                    onClick={() => set({ isRecurring: !isRecurring })} style={{ width: '46px', height: '26px', borderRadius: '99px', border: 'none', cursor: 'pointer', background: isRecurring ? 'var(--gold)' : 'var(--border-input)', position: 'relative', flexShrink: 0 }}>
                    <span aria-hidden="true" style={{ position: 'absolute', top: '3px', left: isRecurring ? '23px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
                </button>
            </div>

            {isRecurring && (
                <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, label]) => (
                            <button key={v} type="button" onClick={() => { setCustom(false); set({ recurrenceType: v, recurrenceInterval: 1 }); }} aria-pressed={!custom && recurrenceType === v} style={pill(!custom && recurrenceType === v)}>{label}</button>
                        ))}
                        <button type="button" onClick={() => { setCustom(true); set({ recurrenceInterval: Math.max(2, recurrenceInterval || 2) }); }} aria-pressed={custom} style={pill(custom)}>Custom</button>
                    </div>

                    {custom && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <label htmlFor={everyId} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>Repeat every</label>
                            <input id={everyId} type="number" min="1" max="52" value={recurrenceInterval}
                                onChange={(e) => set({ recurrenceInterval: Math.min(52, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                                className="input" style={{ width: '72px', textAlign: 'center' }} />
                            <Select value={recurrenceType} onChange={(e) => set({ recurrenceType: e.target.value })} style={{ width: 'auto' }}
                                options={[
                                    { value: 'daily', label: `day${plural}` },
                                    { value: 'weekly', label: `week${plural}` },
                                    { value: 'monthly', label: `month${plural}` },
                                ]}
                                popoverMinWidth={160} aria-label="Repeat unit" sheetTitle="Repeat every" data-testid="recurrence-unit" />
                        </div>
                    )}

                    <div>
                        <div id={endsId} style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                            Ends on <span style={{ fontWeight: '400', textTransform: 'none' }}>(optional — defaults to 3 months)</span>
                        </div>
                        <MiniCalendar value={recurrenceEndDate} onChange={(ds) => set({ recurrenceEndDate: ds })} min={minDate} labelledBy={endsId} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default RecurrenceFields;
