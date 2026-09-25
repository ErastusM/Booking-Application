import React, { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FocusEventHandler, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Popup } from './internal/Popup';
import type { DismissReason } from './internal/Popup';
import { cx, fold, hasFinePointer, NARROW_QUERY, scrollIntoList, useInjectStyles, useMediaQuery } from './internal/dom';
import { makeChangeEvent } from './internal/event';
import type { PickerChangeEvent } from './internal/event';
import { Check, ChevronDown, Search } from './internal/icons';
import { parseOptionChildren, textOf } from './internal/text';

// App-styled replacement for a native <select>. The trigger is a <button> wearing
// the app's `.input` class; the list opens as a bottom sheet on phones and an
// anchored popover elsewhere. onChange receives { target: { value, name } } with
// a string value, exactly like the native control, so handlers move over as-is.

export interface SelectOption {
    value: string | number;
    label: ReactNode;
    disabled?: boolean;
    /** Options sharing a group are listed under that heading (like <optgroup>). */
    group?: string;
    /** Secondary line under the label (e.g. what an access tier allows). */
    description?: ReactNode;
    /** Text used for search/typeahead when `label` is not plain text. */
    searchText?: string;
    /** Displayed when it is the value, but never listed (like <option hidden>). */
    hidden?: boolean;
}

/** A row that runs a command instead of choosing a value (e.g. "+ New category…"). */
export interface SelectAction {
    label: ReactNode;
    onSelect: () => void;
    'data-testid'?: string;
}

export interface SelectProps {
    value?: string | number | null;
    onChange?: (event: PickerChangeEvent) => void;
    /** Same moment as onChange, with just the (string) value. */
    onValueChange?: (value: string) => void;
    /** Either pass `options`, or keep the old <option>/<optgroup> children. */
    options?: SelectOption[];
    children?: ReactNode;
    /** Command rows listed after the options. */
    actions?: SelectAction[];
    /** Muted text while the value is '' (and not an option). Not a list row. */
    placeholder?: ReactNode;
    disabled?: boolean;
    /** Marks the field aria-required. Validate in JS: there is no native bubble. */
    required?: boolean;
    /** Red border via the app's .input[aria-invalid] rule. */
    invalid?: boolean;
    /** Also renders a hidden input so FormData sees the value. */
    name?: string;
    id?: string;
    className?: string;
    style?: CSSProperties;
    /** 'sm' for dense rows (tables, per-row field types). */
    size?: 'md' | 'sm';
    /** Type-to-filter box. Default: on when there are more than 8 options. */
    searchable?: boolean;
    searchPlaceholder?: string;
    emptyText?: ReactNode;
    /** Heading on the phone sheet. Defaults to aria-label, then placeholder. */
    sheetTitle?: ReactNode;
    /** Popover width floor in px (the trigger's own width wins when wider). */
    popoverMinWidth?: number;
    /** Custom trigger content for the selected option. */
    renderValue?: (option: SelectOption | undefined) => ReactNode;
    autoFocus?: boolean;
    onFocus?: FocusEventHandler<HTMLButtonElement>;
    onBlur?: FocusEventHandler<HTMLButtonElement>;
    onOpenChange?: (open: boolean) => void;
    'aria-label'?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
    'data-testid'?: string;
}

type Item =
    | { kind: 'option'; key: string; value: string; option: SelectOption; text: string; disabled: boolean }
    | { kind: 'action'; key: string; action: SelectAction; text: string; disabled: false };

const SEARCH_THRESHOLD = 8;
const TYPEAHEAD_MS = 700;

const isPrintable = (e: ReactKeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
const firstEnabled = (items: Item[], from = 0, dir = 1): number => {
    for (let i = from; i >= 0 && i < items.length; i += dir) if (!items[i].disabled) return i;
    return -1;
};
const nextFrame = (cb: () => void) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(cb);
    else setTimeout(cb, 0);
};

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(props, ref) {
    const {
        value, onChange, onValueChange, options, children, actions, placeholder, disabled, required, invalid,
        name, id, className, style, size = 'md', searchable, searchPlaceholder = 'Search…', emptyText,
        sheetTitle, popoverMinWidth, renderValue, autoFocus, onFocus, onBlur, onOpenChange,
        'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, 'aria-describedby': ariaDescribedBy,
        'data-testid': testId,
    } = props;
    useInjectStyles();

    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);

    const baseId = useId();
    const listId = `${baseId}-list`;
    const optId = (i: number) => `${baseId}-opt-${i}`;

    const narrow = useMediaQuery(NARROW_QUERY);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(-1);
    // On a phone sheet the highlight only shows once the keyboard is in use;
    // a grey first row under a finger reads as "already chosen".
    const [keyboardNav, setKeyboardNav] = useState(false);
    const pendingActive = useRef<number | null>(null);
    const centerNext = useRef(false);
    const typeahead = useRef({ buf: '', at: 0 });

    const strValue = value === null || value === undefined ? '' : String(value);

    const allOptions: SelectOption[] = useMemo(
        () => options ?? parseOptionChildren(children),
        [options, children],
    );
    const listed = useMemo(() => allOptions.filter((o) => !o.hidden), [allOptions]);
    const searchOn = searchable ?? listed.length > SEARCH_THRESHOLD;

    const items: Item[] = useMemo(() => {
        const q = fold(query.trim());
        const out: Item[] = [];
        listed.forEach((o, i) => {
            const text = o.searchText ?? textOf(o.label);
            if (q && !fold(text).includes(q)) return;
            out.push({ kind: 'option', key: `o${i}`, value: String(o.value), option: o, text, disabled: !!o.disabled });
        });
        (actions || []).forEach((a, i) => {
            out.push({ kind: 'action', key: `a${i}`, action: a, text: textOf(a.label), disabled: false });
        });
        return out;
    }, [listed, actions, query]);

    const selected = allOptions.find((o) => String(o.value) === strValue);

    // Where the highlight lands when the list opens or the search text changes.
    useEffect(() => {
        if (!open) return;
        if (pendingActive.current !== null) {
            setActive(pendingActive.current);
            pendingActive.current = null;
        } else if (query) {
            setActive(firstEnabled(items));
        } else {
            const sel = items.findIndex((it) => it.kind === 'option' && it.value === strValue);
            setActive(sel >= 0 ? sel : firstEnabled(items));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, query]);

    // Keep the highlighted row visible; centre the selected row on open.
    useEffect(() => {
        if (!open || active < 0) return;
        const center = centerNext.current;
        centerNext.current = false;
        nextFrame(() => scrollIntoList(listRef.current, document.getElementById(optId(active)), center));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, active]);

    // Searchable lists put the cursor in the search box — except on touch
    // devices, where that would cover the list with the keyboard straight away.
    // Otherwise the phone sheet, a modal dialog, takes focus onto its list (which
    // tracks the highlight by aria-activedescendant), so a screen reader lands on
    // the options instead of staying on the page behind the sheet. The popover
    // keeps focus on the trigger, like a native select.
    useEffect(() => {
        if (!open) return;
        if (searchOn && hasFinePointer()) searchRef.current?.focus({ preventScroll: true });
        else if (narrow) listRef.current?.focus({ preventScroll: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const openList = (initialQuery = '', viaKeyboard = false) => {
        if (disabled || open) return;
        centerNext.current = true;
        setKeyboardNav(viaKeyboard);
        setQuery(initialQuery);
        setOpen(true);
        onOpenChange?.(true);
    };

    const close = (returnFocus: boolean) => {
        setOpen(false);
        setQuery('');
        setActive(-1);
        setKeyboardNav(false);
        onOpenChange?.(false);
        if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
    };

    const commit = (item: Item | undefined) => {
        if (!item || item.disabled) return;
        close(true);
        if (item.kind === 'action') {
            item.action.onSelect();
            return;
        }
        if (item.value !== strValue) {
            onChange?.(makeChangeEvent(item.value, name || ''));
            onValueChange?.(item.value);
        }
    };

    const move = (delta: number) => {
        if (!items.length) return;
        const dir = delta > 0 ? 1 : -1;
        const target = Math.min(items.length - 1, Math.max(0, (active < 0 ? (dir > 0 ? -1 : items.length) : active) + delta));
        const idx = firstEnabled(items, target, dir);
        const fallback = firstEnabled(items, target, -dir);
        const next = idx >= 0 ? idx : fallback;
        if (next >= 0) setActive(next);
    };

    // Native-style typeahead: typing "wi" jumps to "Windhoek"; repeating one
    // letter cycles through the options starting with it.
    const typeaheadIndex = (ch: string, from: number): number => {
        const now = Date.now();
        const ta = typeahead.current;
        ta.buf = now - ta.at > TYPEAHEAD_MS ? ch : ta.buf + ch;
        ta.at = now;
        const q = fold(ta.buf);
        const cycling = ta.buf.length > 1 && ta.buf.split('').every((c) => c === ta.buf[0]);
        const needle = cycling ? q[0] : q;
        const start = ta.buf.length === 1 || cycling ? from + 1 : Math.max(from, 0);
        for (let i = 0; i < items.length; i += 1) {
            const idx = (start + i + items.length) % items.length;
            const it = items[idx];
            if (!it.disabled && it.kind === 'option' && fold(it.text).startsWith(needle)) return idx;
        }
        return -1;
    };

    const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>, fromSearch: boolean) => {
        if (disabled) return;
        const { key } = e;
        if (!open) {
            if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
                e.preventDefault();
                openList('', true);
            } else if (isPrintable(e)) {
                e.preventDefault();
                if (searchOn) {
                    openList(key, true);
                } else {
                    const cur = items.findIndex((it) => it.kind === 'option' && it.value === strValue);
                    const idx = typeaheadIndex(key, cur);
                    if (idx >= 0) pendingActive.current = idx;
                    openList('', true);
                }
            }
            return;
        }
        if (key !== 'Tab' && key !== 'Shift') setKeyboardNav(true);
        switch (key) {
            case 'ArrowDown':
                e.preventDefault();
                move(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (e.altKey) commit(items[active]);
                else move(-1);
                break;
            case 'PageDown':
                e.preventDefault();
                move(10);
                break;
            case 'PageUp':
                e.preventDefault();
                move(-10);
                break;
            case 'Home':
                if (fromSearch) return;
                e.preventDefault();
                setActive(firstEnabled(items));
                break;
            case 'End':
                if (fromSearch) return;
                e.preventDefault();
                setActive(firstEnabled(items, items.length - 1, -1));
                break;
            case 'Enter':
                e.preventDefault();
                commit(items[active]);
                break;
            case 'Tab':
                // Put focus back on the trigger (from the search box or the sheet's
                // list) so Tab carries on from there.
                close(document.activeElement !== triggerRef.current);
                break;
            case ' ':
                if (fromSearch) return;
                e.preventDefault();
                if (Date.now() - typeahead.current.at < TYPEAHEAD_MS) {
                    const idx = typeaheadIndex(' ', active);
                    if (idx >= 0) setActive(idx);
                } else {
                    commit(items[active]);
                }
                break;
            default:
                if (!fromSearch && isPrintable(e)) {
                    e.preventDefault();
                    if (searchOn) {
                        setQuery((q) => q + key);
                        searchRef.current?.focus({ preventScroll: true });
                    } else {
                        const idx = typeaheadIndex(key, active);
                        if (idx >= 0) setActive(idx);
                    }
                }
        }
    };

    const onDismiss = (reason: DismissReason) => {
        // Hand focus back to the trigger, unless it (or a click) went elsewhere.
        close(reason !== 'blur' && (reason !== 'outside' || narrow));
    };

    // ── Trigger ──
    let display: ReactNode;
    let empty = false;
    if (renderValue) {
        display = renderValue(selected);
        empty = !selected && strValue === '';
    } else if (selected && !(selected.hidden && strValue === '')) {
        display = selected.label;
    } else if (strValue === '') {
        empty = true;
        display = placeholder ?? selected?.label ?? ' ';
    } else {
        // A value that isn't an option (legacy data): show it rather than hide it.
        display = strValue;
    }

    const title = sheetTitle ?? ariaLabel ?? (typeof placeholder === 'string' ? placeholder : undefined);
    const activeId = open && active >= 0 ? optId(active) : undefined;

    // ── List body, with <optgroup>-style sections ──
    const optionCount = items.filter((it) => it.kind === 'option').length;
    const rows: ReactNode[] = [];
    let groupRows: ReactNode[] | null = null;
    let groupName: string | undefined;
    const flushGroup = () => {
        if (groupRows && groupName !== undefined) {
            const hid = `${baseId}-g-${rows.length}`;
            rows.push(
                <div role="group" aria-labelledby={hid} key={hid}>
                    <div id={hid} className="bp-group-label" role="presentation">{groupName}</div>
                    {groupRows}
                </div>,
            );
        }
        groupRows = null;
        groupName = undefined;
    };
    items.forEach((it, i) => {
        const isAction = it.kind === 'action';
        const isSelected = !isAction && it.value === strValue;
        const row = (
            <div
                key={it.key}
                id={optId(i)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={it.disabled || undefined}
                data-active={(i === active && (!narrow || keyboardNav)) || undefined}
                data-value={isAction ? undefined : it.value}
                data-testid={isAction ? it.action['data-testid'] : undefined}
                className={cx('bp-opt', isAction && 'bp-opt-action')}
                onMouseMove={() => { if (active !== i && !it.disabled) setActive(i); }}
                onClick={() => commit(it)}
            >
                <span className="bp-opt-body">
                    <span className="bp-opt-label">{isAction ? it.action.label : it.option.label}</span>
                    {!isAction && it.option.description ? <span className="bp-opt-desc">{it.option.description}</span> : null}
                </span>
                {isSelected ? <span className="bp-opt-check"><Check size={16} /></span> : null}
            </div>
        );
        const g = it.kind === 'option' ? it.option.group : undefined;
        if (g !== groupName || (isAction && groupRows)) flushGroup();
        if (isAction && i > 0 && items[i - 1].kind === 'option') rows.push(<div key={`div-${i}`} className="bp-divider" role="presentation" />);
        if (g !== undefined) {
            if (!groupRows) {
                groupRows = [];
                groupName = g;
            }
            groupRows.push(row);
        } else {
            rows.push(row);
        }
    });
    flushGroup();

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                id={id}
                className={cx('input', 'bp-trigger', size === 'sm' && 'bp-sm', className)}
                style={style}
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-activedescendant={activeId}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
                aria-required={required || undefined}
                aria-invalid={invalid || undefined}
                disabled={disabled}
                autoFocus={autoFocus}
                data-testid={testId}
                data-value={strValue}
                data-empty={empty || undefined}
                onClick={() => (open ? close(false) : openList())}
                onKeyDown={(e) => onKeyDown(e, false)}
                onFocus={onFocus}
                onBlur={onBlur}
            >
                <span className="bp-trigger-text">{display}</span>
                <span className="bp-trigger-icon bp-rotates"><ChevronDown size={size === 'sm' ? 14 : 16} /></span>
            </button>
            {name ? <input type="hidden" name={name} value={strValue} /> : null}
            <Popup
                open={open}
                sheet={narrow}
                anchorRef={triggerRef}
                panelRef={panelRef}
                onDismiss={onDismiss}
                title={title}
                minWidth={popoverMinWidth ?? (size === 'sm' ? 180 : 220)}
                sheetHeight={searchOn ? '75vh' : undefined}
                panelProps={{ 'data-testid': testId ? `${testId}-popup` : undefined }}
            >
                {searchOn ? (
                    <div className="bp-search-wrap">
                        <span className="bp-search-icon"><Search size={16} /></span>
                        <input
                            ref={searchRef}
                            className="bp-search"
                            type="text"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded
                            aria-controls={listId}
                            aria-activedescendant={activeId}
                            aria-label={searchPlaceholder.replace(/…$/, '')}
                            placeholder={searchPlaceholder}
                            value={query}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            data-testid={testId ? `${testId}-search` : undefined}
                            onChange={(e) => { setQuery(e.target.value); setKeyboardNav(true); }}
                            onKeyDown={(e) => onKeyDown(e, true)}
                        />
                    </div>
                ) : null}
                <div
                    ref={listRef}
                    id={listId}
                    role="listbox"
                    aria-label={typeof title === 'string' ? title : ariaLabel}
                    className="bp-list"
                    tabIndex={-1}
                    aria-activedescendant={activeId}
                    // The highlighted row gets its focus ring once the keyboard is in use.
                    data-keyboard={keyboardNav || undefined}
                    // Keep focus where it is (trigger, search box or list) while tapping rows,
                    // so the phone keyboard doesn't drop and shift the list mid-tap.
                    onMouseDown={(e) => e.preventDefault()}
                    onKeyDown={(e) => onKeyDown(e, false)}
                >
                    {optionCount === 0 ? (
                        <div className="bp-empty" role="presentation">
                            {emptyText ?? (query ? `No matches for “${query.trim()}”` : 'Nothing to choose from')}
                        </div>
                    ) : null}
                    {rows}
                </div>
            </Popup>
        </>
    );
});
