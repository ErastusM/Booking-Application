import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, FocusEventHandler, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Popup } from './internal/Popup';
import type { DismissReason } from './internal/Popup';
import { cx, NARROW_QUERY, scrollIntoList, useInjectStyles, useMediaQuery } from './internal/dom';
import { makeChangeEvent } from './internal/event';
import type { PickerChangeEvent } from './internal/event';
import { ClockIcon, X } from './internal/icons';
import { fromMinutes, toMinutes } from './internal/dates';

// App-styled replacement for <input type="time">, always 24-hour. Value in and
// out is 'HH:MM' ('' when empty), delivered as { target: { value, name } } like
// the native input — which showed "9:00 AM" on iOS/US-English devices whatever
// the app wanted. Two columns (hour, minute); picking an hour keeps the dialog
// open for the minute, picking a minute closes it. Keyboard: arrows move (and
// set) the value, Left/Right switch column, digits type a time ("0930").

export interface TimePickerProps {
    value?: string | null;
    onChange?: (event: PickerChangeEvent) => void;
    onValueChange?: (value: string) => void;
    /**
     * Minute interval, default 15. Values over 60 that are whole multiples of 60
     * are read as seconds (the native `step` attribute's unit), so step={900}
     * copied from an <input type="time"> still means 15 minutes.
     */
    step?: number;
    /** Earliest selectable time, 'HH:MM'. */
    min?: string;
    /** Latest selectable time, 'HH:MM'. */
    max?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    invalid?: boolean;
    name?: string;
    id?: string;
    className?: string;
    style?: CSSProperties;
    size?: 'md' | 'sm';
    /** × on the trigger and a Clear button (value becomes ''). */
    clearable?: boolean;
    /** Hide the clock icon (narrow grids like weekly hours). */
    hideIcon?: boolean;
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

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const pad = (n: number) => String(n).padStart(2, '0');

const nextFrame = (cb: () => void) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(cb);
    else setTimeout(cb, 0);
};

export const TimePicker = forwardRef<HTMLButtonElement, TimePickerProps>(function TimePicker(props, ref) {
    const {
        value, onChange, onValueChange, step = 15, min, max, placeholder = '--:--', disabled, required, invalid,
        name, id, className, style, size = 'md', clearable, hideIcon, sheetTitle, autoFocus, onFocus, onBlur,
        onOpenChange, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy,
        'aria-describedby': ariaDescribedBy, 'data-testid': testId,
    } = props;
    useInjectStyles();

    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const hourListRef = useRef<HTMLDivElement>(null);
    const minuteListRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);

    const narrow = useMediaQuery(NARROW_QUERY);
    const [open, setOpen] = useState(false);
    const typed = useRef({ buf: '', at: 0 });

    const stepMin = Math.max(1, Math.min(60, step > 60 && step % 60 === 0 ? step / 60 : Math.round(step)));
    const cur = toMinutes(value);
    const strValue = cur === null ? '' : fromMinutes(cur);
    const lo = toMinutes(min) ?? 0;
    const hi = toMinutes(max) ?? 23 * 60 + 59;
    const ok = (t: number) => t >= lo && t <= hi;

    // Minutes on the step grid, plus the current value's minute if it is off-grid
    // (an existing 09:10 must stay visible and selected).
    const minutes: number[] = [];
    for (let m = 0; m < 60; m += stepMin) minutes.push(m);
    if (cur !== null && !minutes.includes(cur % 60)) {
        minutes.push(cur % 60);
        minutes.sort((a, b) => a - b);
    }

    const hourOk = (h: number) => minutes.some((m) => ok(h * 60 + m));

    // With no value yet, the columns open on the next step from now (clamped to
    // min/max) — shown as a hint only, nothing is set until the user picks.
    const suggested = (() => {
        const now = new Date();
        let t = Math.ceil((now.getHours() * 60 + now.getMinutes()) / stepMin) * stepMin;
        if (t >= 24 * 60) t = 0;
        return Math.min(Math.max(t, lo), hi);
    })();
    const shown = cur ?? suggested;
    const shownH = Math.floor(shown / 60);
    const shownM = shown % 60;

    const set = (total: number) => {
        const next = fromMinutes(total);
        if (next !== strValue) {
            onChange?.(makeChangeEvent(next, name || ''));
            onValueChange?.(next);
        }
    };

    const openPicker = () => {
        if (disabled || open) return;
        setOpen(true);
        onOpenChange?.(true);
    };

    const close = (returnFocus: boolean) => {
        setOpen(false);
        onOpenChange?.(false);
        if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
    };

    const onDismiss = (reason: DismissReason) => close(reason === 'escape' || reason === 'drag' || (reason === 'outside' && narrow));

    // Centre the current hour/minute when the columns open.
    useEffect(() => {
        if (!open) return;
        const focusEl = hourListRef.current?.querySelector<HTMLElement>(`[data-h="${shownH}"]`);
        focusEl?.focus({ preventScroll: true });
        nextFrame(() => {
            scrollIntoList(hourListRef.current, hourListRef.current?.querySelector<HTMLElement>(`[data-h="${shownH}"]`) ?? null, true);
            scrollIntoList(minuteListRef.current, minuteListRef.current?.querySelector<HTMLElement>(`[data-m="${shownM}"]`) ?? null, true);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const focusIn = (which: 'h' | 'm', v: number) => {
        const list = which === 'h' ? hourListRef.current : minuteListRef.current;
        const el = list?.querySelector<HTMLElement>(`[data-${which}="${v}"]`) ?? null;
        el?.focus({ preventScroll: true });
        scrollIntoList(list, el);
    };

    const pickHour = (h: number, thenFocusMinutes: boolean) => {
        if (!hourOk(h)) return;
        const keep = cur !== null ? cur % 60 : shownM;
        const m = ok(h * 60 + keep) ? keep : minutes.find((mm) => ok(h * 60 + mm));
        if (m === undefined) return;
        set(h * 60 + m);
        if (thenFocusMinutes) nextFrame(() => focusIn('m', m));
    };

    const pickMinute = (m: number, thenClose: boolean) => {
        const h = cur !== null ? Math.floor(cur / 60) : shownH;
        if (!ok(h * 60 + m)) return;
        set(h * 60 + m);
        if (thenClose) close(true);
    };

    // Typed digits: "9" -> 09:xx, "930" -> 09:30, "1745" -> 17:45.
    const typeDigit = (d: string): boolean => {
        const now = Date.now();
        const t = typed.current;
        t.buf = now - t.at > 1500 || t.buf.length >= 4 ? d : t.buf + d;
        t.at = now;
        const s = t.buf;
        let total: number | null = null;
        if (s.length <= 2) {
            const h = Number(s);
            if (h < 24) {
                const keep = cur !== null ? cur % 60 : 0;
                total = h * 60 + keep;
            }
        } else {
            const h = Number(s.slice(0, s.length - 2));
            const m = Number(s.slice(-2));
            if (h < 24 && m < 60) total = h * 60 + m;
        }
        if (total !== null && ok(total)) {
            set(total);
            return true;
        }
        return false;
    };

    const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (disabled || open) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openPicker();
        } else if (/^\d$/.test(e.key)) {
            e.preventDefault();
            typeDigit(e.key);
        } else if (clearable && strValue && (e.key === 'Backspace' || e.key === 'Delete')) {
            e.preventDefault();
            clear();
        }
    };

    const onColumnKeyDown = (which: 'h' | 'm') => (e: ReactKeyboardEvent) => {
        const list = which === 'h' ? HOURS : minutes;
        const curV = which === 'h' ? shownH : shownM;
        const allowed = (v: number) => (which === 'h' ? hourOk(v) : ok(shownH * 60 + v));
        const idx = list.indexOf(curV);
        const seek = (from: number, dir: number) => {
            for (let i = from; i >= 0 && i < list.length; i += dir) if (allowed(list[i])) return list[i];
            return undefined;
        };
        let target: number | undefined;
        switch (e.key) {
            case 'ArrowDown': target = seek(idx + 1, 1); break;
            case 'ArrowUp': target = seek(idx - 1, -1); break;
            case 'Home': target = seek(0, 1); break;
            case 'End': target = seek(list.length - 1, -1); break;
            case 'ArrowRight':
                if (which === 'h') { e.preventDefault(); focusIn('m', shownM); }
                return;
            case 'ArrowLeft':
                if (which === 'm') { e.preventDefault(); focusIn('h', shownH); }
                return;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (which === 'h') pickHour(shownH, true);
                else pickMinute(shownM, true);
                return;
            default:
                if (/^\d$/.test(e.key)) {
                    e.preventDefault();
                    typeDigit(e.key);
                }
                return;
        }
        e.preventDefault();
        if (target === undefined) return;
        if (which === 'h') pickHour(target, false);
        else pickMinute(target, false);
        nextFrame(() => focusIn(which, target as number));
    };

    const clear = () => {
        if (strValue) {
            onChange?.(makeChangeEvent('', name || ''));
            onValueChange?.('');
        }
    };

    const title = sheetTitle ?? ariaLabel ?? 'Choose a time';
    const empty = cur === null;

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
                aria-label={ariaLabel ? `${ariaLabel}${empty ? '' : `: ${strValue}`}` : undefined}
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
                <span className="bp-trigger-text bp-tnum">{empty ? placeholder : strValue}</span>
                {clearable && !empty && !disabled ? (
                    <span
                        className="bp-trigger-clear"
                        aria-hidden="true"
                        data-testid={testId ? `${testId}-clear` : undefined}
                        onClick={(e) => { e.stopPropagation(); clear(); }}
                    >
                        <X size={14} />
                    </span>
                ) : null}
                {hideIcon ? null : <span className="bp-trigger-icon"><ClockIcon size={size === 'sm' ? 14 : 16} /></span>}
            </button>
            {name ? <input type="hidden" name={name} value={strValue} /> : null}
            <Popup
                open={open}
                sheet={narrow}
                anchorRef={triggerRef}
                panelRef={panelRef}
                onDismiss={onDismiss}
                title={title}
                width={212}
                maxHeight={340}
                panelProps={{
                    role: 'dialog',
                    'aria-modal': narrow || undefined,
                    'aria-label': typeof title === 'string' ? title : 'Choose a time',
                    'data-testid': testId ? `${testId}-popup` : undefined,
                }}
            >
                <div className="bp-time">
                    <div className="bp-time-col">
                        <div className="bp-time-col-label" aria-hidden="true">Hour</div>
                        <div ref={hourListRef} className="bp-time-list" role="listbox" aria-label="Hour" onKeyDown={onColumnKeyDown('h')}>
                            {HOURS.map((h) => {
                                const allowed = hourOk(h);
                                return (
                                    <button
                                        key={h}
                                        type="button"
                                        role="option"
                                        className="bp-time-opt"
                                        data-h={h}
                                        aria-selected={cur !== null && Math.floor(cur / 60) === h}
                                        aria-disabled={!allowed || undefined}
                                        data-active={(cur === null && h === shownH) || undefined}
                                        tabIndex={h === shownH ? 0 : -1}
                                        onClick={() => pickHour(h, true)}
                                    >
                                        {pad(h)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="bp-time-sep" aria-hidden="true">:</div>
                    <div className="bp-time-col">
                        <div className="bp-time-col-label" aria-hidden="true">Min</div>
                        <div ref={minuteListRef} className="bp-time-list" role="listbox" aria-label="Minute" onKeyDown={onColumnKeyDown('m')}>
                            {minutes.map((m) => {
                                const allowed = ok(shownH * 60 + m);
                                return (
                                    <button
                                        key={m}
                                        type="button"
                                        role="option"
                                        className="bp-time-opt"
                                        data-m={m}
                                        aria-selected={cur !== null && cur % 60 === m}
                                        aria-disabled={!allowed || undefined}
                                        data-active={(cur === null && m === shownM) || undefined}
                                        tabIndex={m === shownM ? 0 : -1}
                                        onClick={() => pickMinute(m, true)}
                                    >
                                        {pad(m)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
                <div className="bp-footer">
                    {clearable && strValue ? (
                        <button type="button" className="bp-link-btn" onClick={() => { clear(); close(true); }}>Clear</button>
                    ) : <span />}
                    <button type="button" className="btn-primary" onClick={() => close(true)}>Done</button>
                </div>
            </Popup>
        </>
    );
});
