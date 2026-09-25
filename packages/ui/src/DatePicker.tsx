import React, { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, FocusEventHandler, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Popup } from './internal/Popup';
import type { DismissReason } from './internal/Popup';
import { cx, NARROW_QUERY, useInjectStyles, useMediaQuery } from './internal/dom';
import { makeChangeEvent } from './internal/event';
import type { PickerChangeEvent } from './internal/event';
import { CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, X } from './internal/icons';
import {
    addDays, addMonths, formatDateLong, monthKey, parseKey, startOfMonth, todayKey, toKey,
} from './internal/dates';

// App-styled replacement for <input type="date">. Value in and out is
// 'YYYY-MM-DD' ('' when empty), delivered as { target: { value, name } } like the
// native input. The month grid matches the app's own calendars (MiniCalendar,
// the booking calendar): Sunday-first by default, selected day filled orange,
// today tinted. Phones get it as a bottom sheet.

export interface DatePickerProps {
    value?: string | null;
    onChange?: (event: PickerChangeEvent) => void;
    onValueChange?: (value: string) => void;
    /** Earliest selectable day, 'YYYY-MM-DD'. */
    min?: string;
    /** Latest selectable day, 'YYYY-MM-DD'. */
    max?: string;
    /** Extra per-day rule (closed days, holidays…). */
    isDateDisabled?: (date: string) => boolean;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    invalid?: boolean;
    name?: string;
    id?: string;
    className?: string;
    style?: CSSProperties;
    size?: 'md' | 'sm';
    /** Show an × on the trigger and a Clear button (value becomes ''). */
    clearable?: boolean;
    /** Show the Today shortcut (hidden automatically when today isn't allowed). */
    showToday?: boolean;
    /** 0 = Sunday (the app's month grids), 1 = Monday. */
    weekStartsOn?: 0 | 1;
    /** Trigger text for a value. Default "Tue, Aug 5, 2025". */
    formatValue?: (date: string) => string;
    sheetTitle?: ReactNode;
    autoFocus?: boolean;
    onFocus?: FocusEventHandler<HTMLButtonElement>;
    onBlur?: FocusEventHandler<HTMLButtonElement>;
    onOpenChange?: (open: boolean) => void;
    'aria-label'?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
    'data-testid'?: string;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DatePicker = forwardRef<HTMLButtonElement, DatePickerProps>(function DatePicker(props, ref) {
    const {
        value, onChange, onValueChange, min, max, isDateDisabled, placeholder = 'Select a date', disabled,
        required, invalid, name, id, className, style, size = 'md', clearable, showToday = true,
        weekStartsOn = 0, formatValue = formatDateLong, sheetTitle, autoFocus, onFocus, onBlur, onOpenChange,
        'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, 'aria-describedby': ariaDescribedBy,
        'data-testid': testId,
    } = props;
    useInjectStyles();

    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);
    const baseId = useId();

    const narrow = useMediaQuery(NARROW_QUERY);
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<'days' | 'months'>('days');
    const [view, setView] = useState<Date>(() => startOfMonth(new Date()));
    const [focusKey, setFocusKey] = useState('');
    // Only move DOM focus into the grid after keyboard navigation or on open,
    // never on a re-render the user didn't cause.
    const wantFocus = useRef(false);

    const strValue = value || '';
    // Tolerate a full ISO string ('2026-03-10T00:00:00Z') by keeping its date part.
    const parsedValue = parseKey(strValue);
    const valid = parsedValue ? toKey(parsedValue) : '';
    const today = todayKey();

    const minDate = parseKey(min);
    const maxDate = parseKey(max);
    const minKey = minDate ? toKey(minDate) : '';
    const maxKey = maxDate ? toKey(maxDate) : '';

    const isAllowed = (key: string) =>
        (!minKey || key >= minKey) && (!maxKey || key <= maxKey) && !(isDateDisabled && isDateDisabled(key));
    const clampKey = (key: string) => (minKey && key < minKey ? minKey : maxKey && key > maxKey ? maxKey : key);
    const canPrev = !minDate || monthKey(view) > monthKey(minDate);
    const canNext = !maxDate || monthKey(view) < monthKey(maxDate);

    const openPicker = () => {
        if (disabled || open) return;
        const start = valid || clampKey(today);
        setView(startOfMonth(parseKey(start) || new Date()));
        setFocusKey(start);
        setMode('days');
        wantFocus.current = true;
        setOpen(true);
        onOpenChange?.(true);
    };

    const close = (returnFocus: boolean) => {
        setOpen(false);
        onOpenChange?.(false);
        if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
    };

    const commit = (key: string) => {
        close(true);
        if (key !== strValue) {
            onChange?.(makeChangeEvent(key, name || ''));
            onValueChange?.(key);
        }
    };

    const onDismiss = (reason: DismissReason) => close(reason === 'escape' || reason === 'drag' || (reason === 'outside' && narrow));

    // Roving focus: the focused day is the grid's single tab stop.
    useEffect(() => {
        if (!open || mode !== 'days' || !wantFocus.current) return;
        wantFocus.current = false;
        const el = panelRef.current?.querySelector<HTMLButtonElement>(`[data-key="${focusKey}"]`);
        el?.focus({ preventScroll: true });
    }, [open, mode, focusKey, view]);

    const moveFocus = (to: Date) => {
        const key = clampKey(toKey(to));
        const d = parseKey(key) as Date;
        if (monthKey(d) !== monthKey(view)) setView(startOfMonth(d));
        wantFocus.current = true;
        setFocusKey(key);
    };

    const onGridKeyDown = (e: ReactKeyboardEvent) => {
        const cur = parseKey(focusKey) || new Date();
        const dow = (cur.getDay() - weekStartsOn + 7) % 7;
        const map: Record<string, () => Date> = {
            ArrowLeft: () => addDays(cur, -1),
            ArrowRight: () => addDays(cur, 1),
            ArrowUp: () => addDays(cur, -7),
            ArrowDown: () => addDays(cur, 7),
            Home: () => addDays(cur, -dow),
            End: () => addDays(cur, 6 - dow),
            PageUp: () => addMonths(cur, e.shiftKey ? -12 : -1),
            PageDown: () => addMonths(cur, e.shiftKey ? 12 : 1),
        };
        const fn = map[e.key];
        if (fn) {
            e.preventDefault();
            moveFocus(fn());
        }
    };

    const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;
        if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openPicker();
        } else if (clearable && !open && strValue && (e.key === 'Backspace' || e.key === 'Delete')) {
            e.preventDefault();
            commit('');
        }
    };

    const shiftView = (months: number) => {
        const next = addMonths(view, months);
        setView(startOfMonth(next));
        // Keep the roving tab stop inside the month being shown.
        const d = parseKey(focusKey) || next;
        setFocusKey(clampKey(toKey(new Date(next.getFullYear(), next.getMonth(), Math.min(d.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate())))));
    };

    // ── Day grid (always 6 rows, so the popup never changes height) ──
    const y = view.getFullYear();
    const mo = view.getMonth();
    const lead = (new Date(y, mo, 1).getDay() - weekStartsOn + 7) % 7;
    const daysIn = new Date(y, mo + 1, 0).getDate();
    const cells: Array<Date | null> = [];
    for (let i = 0; i < lead; i += 1) cells.push(null);
    for (let d = 1; d <= daysIn; d += 1) cells.push(new Date(y, mo, d));
    while (cells.length < 42) cells.push(null);
    const weeks: Array<Array<Date | null>> = [];
    for (let i = 0; i < 42; i += 7) weeks.push(cells.slice(i, i + 7));
    const dowLabels = weekStartsOn === 1 ? [...DOW.slice(1), DOW[0]] : DOW;
    // The tab stop must be a day that is actually rendered.
    const tabKey = focusKey && parseKey(focusKey) && monthKey(parseKey(focusKey) as Date) === monthKey(view)
        ? focusKey
        : toKey(view);

    const monthLabel = view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const title = sheetTitle ?? ariaLabel ?? 'Choose a date';
    const todayOk = showToday && isAllowed(today);
    const empty = !strValue;

    const header = mode === 'days' ? (
        <div className="bp-cal-head">
            <button type="button" className="bp-icon-btn" aria-label="Previous month" disabled={!canPrev} onClick={() => shiftView(-1)}>
                <ChevronLeft size={18} />
            </button>
            <button
                type="button"
                className="bp-cal-title"
                aria-live="polite"
                aria-label={`${monthLabel}, choose month`}
                onClick={() => setMode('months')}
            >
                {monthLabel}
                <ChevronDown size={14} />
            </button>
            <button type="button" className="bp-icon-btn" aria-label="Next month" disabled={!canNext} onClick={() => shiftView(1)}>
                <ChevronRight size={18} />
            </button>
        </div>
    ) : (
        <div className="bp-cal-head">
            <button
                type="button"
                className="bp-icon-btn"
                aria-label="Previous year"
                disabled={!!minDate && y <= minDate.getFullYear()}
                onClick={() => setView(new Date(y - 1, mo, 1))}
            >
                <ChevronLeft size={18} />
            </button>
            <button type="button" className="bp-cal-title" aria-live="polite" aria-label={`${y}, back to days`} onClick={() => setMode('days')}>
                {y}
            </button>
            <button
                type="button"
                className="bp-icon-btn"
                aria-label="Next year"
                disabled={!!maxDate && y >= maxDate.getFullYear()}
                onClick={() => setView(new Date(y + 1, mo, 1))}
            >
                <ChevronRight size={18} />
            </button>
        </div>
    );

    const body = mode === 'days' ? (
        <div role="grid" aria-label={monthLabel} onKeyDown={onGridKeyDown}>
            <div className="bp-cal-grid" role="row">
                {dowLabels.map((d) => (
                    <div key={d} className="bp-cal-dow" role="columnheader" aria-label={d}>{d.slice(0, 1)}</div>
                ))}
            </div>
            {weeks.map((week, wi) => (
                <div key={wi} className="bp-cal-grid" role="row" style={{ marginTop: 3 }}>
                    {week.map((d, di) => {
                        if (!d) return <div key={di} role="gridcell" aria-hidden="true" />;
                        const key = toKey(d);
                        const allowed = isAllowed(key);
                        return (
                            <button
                                key={di}
                                type="button"
                                role="gridcell"
                                className="bp-day"
                                data-key={key}
                                data-today={key === today || undefined}
                                aria-current={key === today ? 'date' : undefined}
                                aria-selected={key === valid}
                                aria-disabled={!allowed || undefined}
                                aria-label={d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                                tabIndex={key === tabKey ? 0 : -1}
                                onClick={() => allowed && commit(key)}
                                onFocus={() => { if (focusKey !== key) setFocusKey(key); }}
                            >
                                {d.getDate()}
                            </button>
                        );
                    })}
                </div>
            ))}
        </div>
    ) : (
        <div className="bp-month-grid">
            {MONTHS.map((m, i) => {
                const first = new Date(y, i, 1);
                const last = new Date(y, i + 1, 0);
                const out = (!!minDate && last < minDate) || (!!maxDate && first > maxDate);
                return (
                    <button
                        key={m}
                        type="button"
                        className="bp-month"
                        disabled={out}
                        aria-pressed={i === mo}
                        data-current={monthKey(first) === monthKey(new Date()) || undefined}
                        onClick={() => {
                            setView(first);
                            const d = parseKey(focusKey) || first;
                            setFocusKey(clampKey(toKey(new Date(y, i, Math.min(d.getDate(), last.getDate())))));
                            wantFocus.current = true;
                            setMode('days');
                        }}
                    >
                        {m}
                    </button>
                );
            })}
        </div>
    );

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                id={id}
                className={cx('input', 'bp-trigger', size === 'sm' && 'bp-sm', className)}
                style={style}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={ariaLabel ? `${ariaLabel}${valid ? `: ${formatValue(valid)}` : ''}` : undefined}
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
                aria-required={required || undefined}
                aria-invalid={invalid || undefined}
                disabled={disabled}
                autoFocus={autoFocus}
                data-testid={testId}
                data-value={strValue}
                data-empty={empty || undefined}
                onClick={() => (open ? close(false) : openPicker())}
                onKeyDown={onTriggerKeyDown}
                onFocus={onFocus}
                onBlur={onBlur}
            >
                <span className="bp-trigger-text bp-tnum">{empty ? placeholder : valid ? formatValue(valid) : strValue}</span>
                {clearable && !empty && !disabled ? (
                    // Mouse/touch shortcut; keyboard users clear with Backspace/Delete
                    // or the Clear button inside the picker.
                    <span
                        className="bp-trigger-clear"
                        aria-hidden="true"
                        data-testid={testId ? `${testId}-clear` : undefined}
                        onClick={(e) => { e.stopPropagation(); commit(''); }}
                    >
                        <X size={14} />
                    </span>
                ) : null}
                <span className="bp-trigger-icon"><CalendarIcon size={size === 'sm' ? 14 : 16} /></span>
            </button>
            {name ? <input type="hidden" name={name} value={strValue} /> : null}
            <Popup
                open={open}
                sheet={narrow}
                anchorRef={triggerRef}
                panelRef={panelRef}
                onDismiss={onDismiss}
                title={title}
                width={304}
                maxHeight={440}
                panelProps={{
                    role: 'dialog',
                    'aria-modal': narrow || undefined,
                    'aria-label': typeof title === 'string' ? title : 'Choose a date',
                    id: `${baseId}-dialog`,
                    'data-testid': testId ? `${testId}-popup` : undefined,
                }}
            >
                <div className="bp-cal">
                    <div className="bp-cal-inner">
                        {header}
                        {body}
                    </div>
                </div>
                {todayOk || (clearable && strValue) ? (
                    <div className="bp-footer">
                        {todayOk ? (
                            <button type="button" className="btn-outline" onClick={() => commit(today)}>Today</button>
                        ) : <span />}
                        {clearable && strValue ? (
                            <button type="button" className="bp-link-btn" onClick={() => commit('')}>Clear</button>
                        ) : null}
                    </div>
                ) : null}
            </Popup>
        </>
    );
});
