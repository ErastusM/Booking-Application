import React from 'react';
import { TimePicker } from '@bookplus/ui';
import { X, Plus } from 'lucide-react';
import { MAX_PERIODS, capDay, secondPeriodFor } from '../utils/workingHours';

/**
 * One day's working periods on the Working Hours screen: an opening and a
 * closing time, and — for a split day — a second period after a break
 * ("+ Add a break / second period"), which can be removed again.
 *
 * `periods` is the day's slots in the order shown; `onChange(next)` gets the
 * whole new list. Labels name the day and the period, so every time picker is
 * findable by a screen reader ("Monday second period closing time").
 */
const ORDINAL = ['', 'second ', 'third '];

// 96px pickers keep a split day's second row — two times, "to" and the remove
// button — on one line next to the day's switch on a 390px phone.
const DayPeriods = ({ day, periods, onChange, words = ['opening', 'closing'], pickerWidth = '96px' }) => {
    const [openW, closeW] = words;
    const Day = capDay(day);
    const list = periods && periods.length ? periods : [];
    const set = (i, field, value) => onChange(list.map((p, j) => (j === i ? { ...p, [field]: value } : p)));
    const remove = (i) => onChange(list.filter((_, j) => j !== i));
    const plan = list.length === 1 ? secondPeriodFor(list[0]) : null;
    const add = () => { if (plan) onChange([plan.first, plan.second]); };
    const pickerStyle = { width: pickerWidth, maxWidth: '40vw', padding: '0.45rem 0.5rem', fontSize: '1rem' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }} data-testid={`day-periods-${day}`}>
            {list.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }} data-testid="day-period">
                    <TimePicker value={p.start || ''} onChange={(e) => set(i, 'start', e.target.value)}
                        aria-label={`${Day} ${ORDINAL[i] || ''}${i ? 'period ' : ''}${openW} time`}
                        sheetTitle={`${Day} ${i ? `${ORDINAL[i]}period ` : ''}${openW} time`} hideIcon style={pickerStyle} />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', flexShrink: 0 }}>to</span>
                    <TimePicker value={p.end || ''} onChange={(e) => set(i, 'end', e.target.value)}
                        aria-label={`${Day} ${ORDINAL[i] || ''}${i ? 'period ' : ''}${closeW} time`}
                        sheetTitle={`${Day} ${i ? `${ORDINAL[i]}period ` : ''}${closeW} time`} hideIcon style={pickerStyle} />
                    {i > 0 && (
                        <button type="button" onClick={() => remove(i)} aria-label={`Remove ${Day}’s ${ORDINAL[i]}period`} data-testid="remove-period"
                            style={{ width: '28px', height: '28px', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: '50%', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
                            <X size={16} />
                        </button>
                    )}
                </div>
            ))}
            {list.length < MAX_PERIODS && plan && (
                <button type="button" className="btn-outline" onClick={add} data-testid="add-period"
                    aria-label={`Add a break / second period on ${Day}`}
                    style={{ alignSelf: 'flex-start', padding: '0.3rem 0.7rem', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Plus size={13} aria-hidden="true" /> Add a break / second period
                </button>
            )}
        </div>
    );
};

export default DayPeriods;
