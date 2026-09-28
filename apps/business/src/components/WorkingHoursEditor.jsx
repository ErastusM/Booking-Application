import React from 'react';
import DayPeriods from './DayPeriods';
import { WEEK_DAYS, DEFAULT_PERIOD } from '../utils/workingHours';

/**
 * The Working Hours screen — ONE component for everyone who has hours:
 *   - the owner's own hours (Dashboard → Availability),
 *   - a team member's own hours (the same tab, over their week), and
 *   - the owner setting a member's hours from Team.
 * One row per weekday with an on/off switch, the day's times ("08:00 to
 * 20:00"), "+ Add a break / second period" for a split day, and Save Changes.
 *
 * It only draws and edits: the caller owns loading and saving.
 *   week      { monday: { enabled, slots: [{start,end}] }, … } — every day present
 *   onChange  (nextWeek) => void
 *   onSave    () => void
 *   saving    true while the save is in flight (disables the button)
 *   success   a short "saved" line, shown as a status message
 *   notice    an optional note above the rows (e.g. "clients can't book you yet")
 *   compact   smaller header and tighter rows, for use inside a card (Team),
 *             so a day's two times stay on one line on a 390px phone
 */
const WorkingHoursEditor = ({
    title = 'Working Hours', subtitle, week, onChange, onSave, saving = false,
    success = '', notice = null, compact = false, headingLevel = 2, testId = 'working-hours',
}) => {
    const Heading = `h${headingLevel}`;
    const toggle = (day) => onChange({ ...week, [day]: { ...week[day], enabled: !week[day].enabled } });
    const setPeriods = (day, slots) => onChange({ ...week, [day]: { ...week[day], slots } });

    return (
        <div data-testid={testId}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: compact ? '1rem' : '1.5rem' }}>
                <div style={{ minWidth: 0 }}>
                    <Heading style={{ fontFamily: 'var(--font-display)', fontSize: compact ? '1.05rem' : '1.3rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>{title}</Heading>
                    {subtitle && <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem', marginBottom: 0 }}>{subtitle}</p>}
                </div>
                <button type="button" onClick={onSave} disabled={saving || !week} className="btn-primary" data-testid="save-hours" style={{ padding: '0.65rem 1.5rem', fontSize: '0.875rem', minHeight: '44px' }}>
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>

            {notice && (
                <div data-testid="hours-notice" style={{ background: 'rgba(240,62,22,0.1)', border: '1px solid rgba(240,62,22,0.3)', color: 'var(--charcoal)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.25rem', fontSize: '0.875rem' }}>
                    {notice}
                </div>
            )}

            {success && (
                <div role="status" style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                    {success}
                </div>
            )}

            {week && (
                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                    {WEEK_DAYS.filter((day) => week[day]).map((day, i, days) => {
                        const config = week[day];
                        return (
                            <div key={day} data-testid={`hours-row-${day}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: compact ? '0.6rem' : '1rem', padding: compact ? '0.95rem 0.85rem' : '1.05rem 1.25rem', borderBottom: i < days.length - 1 ? '1px solid var(--border)' : 'none', background: config.enabled ? 'var(--card-bg)' : 'var(--surface-sunken)', transition: 'background 0.2s' }}>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontWeight: '600', color: config.enabled ? 'var(--charcoal)' : 'var(--text-muted)', fontSize: '1rem', textTransform: 'capitalize', marginBottom: config.enabled ? '0.55rem' : 0 }}>{day}</div>
                                    {config.enabled ? (
                                        <DayPeriods day={day} periods={config.slots?.length ? config.slots : [{ ...DEFAULT_PERIOD }]}
                                            pickerWidth={compact ? '84px' : undefined}
                                            onChange={(slots) => setPeriods(day, slots)} />
                                    ) : (
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Not available</div>
                                    )}
                                </div>
                                {/* The switch is drawn 50×30, inside a 44px-tall hit area. */}
                                <button type="button" role="switch" aria-checked={!!config.enabled} onClick={() => toggle(day)} aria-label={`Open on ${day}`} style={{ width: '50px', height: '44px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0, alignSelf: 'center', display: 'inline-flex', alignItems: 'center' }}>
                                    <span aria-hidden="true" style={{ display: 'block', width: '50px', height: '30px', borderRadius: '99px', background: config.enabled ? 'var(--gold)' : 'var(--border-input)', position: 'relative', transition: 'background 0.2s' }}>
                                        <span style={{ display: 'block', width: '24px', height: '24px', borderRadius: '50%', background: 'white', position: 'absolute', top: '3px', left: '3px', transform: config.enabled ? 'translateX(20px)' : 'translateX(0)', transition: 'transform 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default WorkingHoursEditor;
