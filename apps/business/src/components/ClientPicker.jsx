import React, { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { sortClients } from '../utils/clientSort';
import { cloudinaryAvatar } from '../utils/cloudinary';

// The New Appointment "who is this for?" list — a phone-contacts style roster:
// search box on top, one row per client (picture or initials, name, phone,
// visits, last visit, a radio), alphabetical section headers and an A–Z rail
// down the right edge that jumps (tap) or scrubs (drag) to a letter.
//
// Takes the CRM roll-up rows from GET /api/crm/clients as they are
// ({ customer: { _id, name, email, phone, avatar }, isWalkIn, completedVisits,
// lastCompletedVisit }). Visits are completed bookings only — not the roster's
// `visits` / `lastVisit`, which also count cancelled, no-show and upcoming ones.
// and keeps the app's one client order (utils/clientSort: A–Z, case- and
// accent-blind, nameless last). onChange gets the picked client's id; a walk-in
// keeps its "walkin:<name>" id, which utils/bookingClient turns into a name.
//
// Built for a roster of thousands on a phone: rows have fixed heights and only
// the ones near the viewport are rendered (a few dozen at a time), pictures load
// lazily, and the list scrolls inside itself (overscroll contained) so the page
// behind the modal never moves.
//
// Accessibility: the list is a single-select listbox (one tab stop,
// aria-activedescendant). Arrow keys / Home / End / PageUp / PageDown move,
// Enter or Space picks, typing a letter jumps to that letter's section (again
// cycles within it). The rail is a vertical toolbar of labelled letter buttons.

export const ROW_H = 72;
export const HEAD_H = 28;
const OVERSCAN = 6 * ROW_H;
const FALLBACK_VIEWPORT = 480; // before layout / in jsdom
const TYPEAHEAD_MS = 700;
// '#' leads: names starting with a digit or symbol sort before "A" (clientSort).
export const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const NO_NAME = 'No name'; // nameless clients (shown by email) sort last, off the rail

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '');

const labelOf = (c) => c.customer?.name?.trim() || c.customer?.email || 'Unnamed client';
const sectionOf = (c) => {
    const name = c.customer?.name?.trim();
    if (!name) return NO_NAME;
    const ch = fold(name).charAt(0).toUpperCase();
    return ch >= 'A' && ch <= 'Z' ? ch : '#';
};
const initialsOf = (c) => {
    const name = c.customer?.name?.trim();
    if (!name) return '?';
    const parts = name.split(/\s+/).filter(Boolean);
    const first = [...parts[0]][0] || '';
    const last = parts.length > 1 ? [...parts[parts.length - 1]][0] || '' : '';
    return (first + last).toUpperCase();
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Day-month, as the app writes dates: "26 May" this year, "26 May 2025" before.
// Built by hand so no device locale turns it into "May 26" (or "Sept").
export const fmtDayMonth = (d, now = new Date()) => {
    const t = d ? new Date(d) : null;
    if (!t || Number.isNaN(t.getTime())) return null;
    const dm = `${t.getDate()} ${MONTHS[t.getMonth()]}`;
    return t.getFullYear() === now.getFullYear() ? dm : `${dm} ${t.getFullYear()}`;
};

// Name, phone (as typed or digits only) or email.
export const matchesClient = (c, query) => {
    const q = fold(query).trim();
    if (!q) return true;
    const cust = c.customer || {};
    if (fold(`${cust.name || ''} ${cust.email || ''} ${cust.phone || ''}`).includes(q)) return true;
    const qd = digits(q);
    return qd.length >= 3 && q.replace(/[\s()+.-]/g, '') === qd && digits(cust.phone).includes(qd);
};

// First index i with ends[i] > y (ends ascending).
const firstEndingAfter = (items, y) => {
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (items[mid].top + items[mid].h > y) hi = mid; else lo = mid + 1;
    }
    return lo;
};

function Avatar({ client }) {
    const [broken, setBroken] = useState(false);
    const src = client.customer?.avatar;
    if (src && !broken) {
        return (
            <img
                className="cp-avatar"
                src={cloudinaryAvatar(src, 96)}
                alt=""
                loading="lazy"
                decoding="async"
                width={40}
                height={40}
                onError={() => setBroken(true)}
            />
        );
    }
    return <span className="cp-avatar cp-initials" aria-hidden="true">{initialsOf(client)}</span>;
}

const ClientPicker = forwardRef(function ClientPicker(props, ref) {
    const {
        clients,
        value,
        onChange,
        required,
        invalid,
        'aria-label': ariaLabel = 'Client',
        'aria-describedby': ariaDescribedBy,
        'data-testid': testId = 'client-picker',
        searchPlaceholder = 'Name, phone or email',
        height = 'min(52dvh, 440px)',
        emptyText = 'No clients yet.',
    } = props;

    const baseId = useId();
    const listId = `${baseId}-list`;
    const optId = (i) => `${baseId}-opt-${i}`;
    const listRef = useRef(null);
    const railRef = useRef(null);
    const typeahead = useRef({ buf: '', at: 0 });
    const dragging = useRef(false);

    const [query, setQuery] = useState('');
    const [scrollTop, setScrollTop] = useState(0);
    const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
    const [active, setActive] = useState(-1); // index into `rows`
    const [bubble, setBubble] = useState(null); // letter shown while scrubbing the rail
    const [announce, setAnnounce] = useState('');
    const [railFocus, setRailFocus] = useState('A');

    useImperativeHandle(ref, () => listRef.current);

    const sorted = useMemo(() => sortClients(clients || []).filter((c) => c?.customer?._id), [clients]);
    const rows = useMemo(() => sorted.filter((c) => matchesClient(c, query)), [sorted, query]);

    // Flat layout: a header before each run of one letter, then its rows.
    const { items, total, rowItem, sectionStart } = useMemo(() => {
        const out = [];
        const rowAt = [];
        const starts = {};
        let y = 0;
        let prev = null;
        rows.forEach((c, i) => {
            let letter = sectionOf(c);
            // A letter outside A–Z in the middle of the alphabet ("Łucja" sorts
            // after "L") stays in the section it sorts into, not a stray "#".
            if (letter === '#' && prev && prev !== '#' && prev !== NO_NAME) letter = prev;
            if (letter !== prev) {
                if (!(letter in starts)) starts[letter] = { itemTop: y, row: i };
                out.push({ kind: 'head', key: `h-${letter}-${i}`, letter, top: y, h: HEAD_H });
                y += HEAD_H;
                prev = letter;
            }
            rowAt[i] = out.length;
            out.push({ kind: 'row', key: c.customer._id, client: c, index: i, letter, top: y, h: ROW_H });
            y += ROW_H;
        });
        return { items: out, total: y, rowItem: rowAt, sectionStart: starts };
    }, [rows]);

    const selectedIndex = useMemo(
        () => (value ? rows.findIndex((c) => String(c.customer._id) === String(value)) : -1),
        [rows, value],
    );

    // Measure the viewport (and follow resizes / rotation).
    useLayoutEffect(() => {
        const el = listRef.current;
        if (!el) return undefined;
        const measure = () => { if (el.clientHeight) setViewport(el.clientHeight); };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // A new search starts at the top of its results.
    useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = 0;
        setScrollTop(0);
        setActive(-1);
    }, [query]);

    const scrollListTo = useCallback((y) => {
        const max = Math.max(0, total - viewport);
        const top = Math.max(0, Math.min(max, y));
        if (listRef.current) listRef.current.scrollTop = top;
        setScrollTop(top); // render the target window now, not on the scroll event
    }, [total, viewport]);

    // Keep row i on screen (for the keyboard).
    const reveal = useCallback((i) => {
        const it = items[rowItem[i]];
        if (!it) return;
        const cur = listRef.current ? listRef.current.scrollTop : scrollTop;
        // The section header sticks over the top HEAD_H px of the viewport.
        if (it.top - HEAD_H < cur) scrollListTo(it.top - HEAD_H);
        else if (it.top + it.h > cur + viewport) scrollListTo(it.top + it.h - viewport);
    }, [items, rowItem, scrollTop, viewport, scrollListTo]);

    const moveTo = (i) => {
        if (!rows.length) return;
        const next = Math.max(0, Math.min(rows.length - 1, i));
        setActive(next);
        reveal(next);
    };

    const pick = (i) => {
        const c = rows[i];
        if (!c) return;
        setActive(i);
        if (String(c.customer._id) !== String(value ?? '')) onChange?.(String(c.customer._id));
    };

    // The letter's section, or the nearest one after it (then before it).
    const targetLetter = useCallback((letter) => {
        if (sectionStart[letter]) return letter;
        const at = LETTERS.indexOf(letter);
        for (let i = at + 1; i < LETTERS.length; i += 1) if (sectionStart[LETTERS[i]]) return LETTERS[i];
        for (let i = at - 1; i >= 0; i -= 1) if (sectionStart[LETTERS[i]]) return LETTERS[i];
        return null;
    }, [sectionStart]);

    const jumpTo = useCallback((letter) => {
        const t = targetLetter(letter);
        if (!t) return;
        const s = sectionStart[t];
        scrollListTo(s.itemTop);
        setActive(s.row);
        setAnnounce(t === letter ? `${t}` : `No clients under ${letter}, showing ${t}`);
    }, [targetLetter, sectionStart, scrollListTo]);

    // Typing on the list: a letter jumps to its section; repeating it cycles
    // through that section; a longer run ("mar") finds the first name starting so.
    const typeaheadTo = (ch) => {
        const now = Date.now();
        const ta = typeahead.current;
        ta.buf = now - ta.at > TYPEAHEAD_MS ? ch : ta.buf + ch;
        ta.at = now;
        const buf = fold(ta.buf);
        const cycling = buf.length > 1 && [...buf].every((c) => c === buf[0]);
        if (buf.length === 1 && /[a-z]/.test(buf) && (active < 0 || items[rowItem[active]]?.letter !== buf.toUpperCase())) {
            jumpTo(buf.toUpperCase());
            return;
        }
        const needle = cycling ? buf[0] : buf;
        const start = buf.length === 1 || cycling ? active + 1 : Math.max(active, 0);
        for (let k = 0; k < rows.length; k += 1) {
            const i = (start + k) % rows.length;
            if (fold(labelOf(rows[i])).startsWith(needle)) { moveTo(i); return; }
        }
    };

    const onListKeyDown = (e) => {
        const cur = active >= 0 ? active : (selectedIndex >= 0 ? selectedIndex : -1);
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); moveTo(cur + 1); break;
            case 'ArrowUp': e.preventDefault(); moveTo(cur < 0 ? 0 : cur - 1); break;
            case 'PageDown': e.preventDefault(); moveTo(cur + Math.max(1, Math.floor(viewport / ROW_H) - 1)); break;
            case 'PageUp': e.preventDefault(); moveTo(cur - Math.max(1, Math.floor(viewport / ROW_H) - 1)); break;
            case 'Home': e.preventDefault(); moveTo(0); break;
            case 'End': e.preventDefault(); moveTo(rows.length - 1); break;
            case 'Enter':
            case ' ':
                e.preventDefault(); // never submit the booking form from the list
                if (cur >= 0) pick(cur);
                break;
            default:
                if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
                    e.preventDefault();
                    typeaheadTo(e.key);
                }
        }
    };

    const onListFocus = () => {
        if (active < 0 && rows.length) {
            const i = selectedIndex >= 0 ? selectedIndex : 0;
            setActive(i);
            reveal(i);
        }
    };

    const onSearchKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            listRef.current?.focus();
            moveTo(active >= 0 ? active : 0);
        } else if (e.key === 'Enter') {
            e.preventDefault(); // Enter in the search box must not book the appointment
            if (rows.length === 1) pick(0);
            else if (rows.length) { listRef.current?.focus(); moveTo(0); }
        } else if (e.key === 'Escape' && query) {
            e.preventDefault();
            e.stopPropagation(); // clear the search, don't close the modal
            setQuery('');
        }
    };

    // ── Rail: tap a letter, or press and drag along it ──
    const letterAtY = (y) => {
        const rect = railRef.current?.getBoundingClientRect();
        if (!rect || !rect.height || !Number.isFinite(y)) return null;
        const i = Math.floor(((y - rect.top) / rect.height) * LETTERS.length);
        return LETTERS[Math.max(0, Math.min(LETTERS.length - 1, i))];
    };
    const onRailPointerDown = (e) => {
        const btn = e.target.closest?.('[data-letter]');
        const letter = btn?.dataset.letter || letterAtY(e.clientY);
        if (!letter) return;
        if (e.pointerType !== 'mouse') e.preventDefault(); // no focus ring / no page scroll on touch
        dragging.current = true;
        try { railRef.current?.setPointerCapture?.(e.pointerId); } catch { /* jsdom */ }
        setBubble(letter);
        setRailFocus(letter);
        jumpTo(letter);
    };
    const onRailPointerMove = (e) => {
        if (!dragging.current) return;
        const letter = letterAtY(e.clientY);
        if (letter && letter !== bubble) {
            setBubble(letter);
            setRailFocus(letter);
            jumpTo(letter);
        }
    };
    const endDrag = () => { dragging.current = false; setBubble(null); };
    const onRailKeyDown = (e) => {
        const at = LETTERS.indexOf(railFocus);
        let next = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = LETTERS[Math.min(LETTERS.length - 1, at + 1)];
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = LETTERS[Math.max(0, at - 1)];
        else if (e.key === 'Home') next = LETTERS[0];
        else if (e.key === 'End') next = LETTERS[LETTERS.length - 1];
        if (next) {
            e.preventDefault();
            setRailFocus(next);
            railRef.current?.querySelector(`[data-letter="${next}"]`)?.focus();
        }
    };

    // ── Window of rows to render ──
    const from = firstEndingAfter(items, scrollTop - OVERSCAN);
    const visible = [];
    for (let k = from; k < items.length && items[k].top < scrollTop + viewport + OVERSCAN; k += 1) visible.push(items[k]);
    // aria-activedescendant must always name a rendered row, even after the
    // list was scrolled away from it with the wheel or a finger.
    const activeItem = active >= 0 ? items[rowItem[active]] : null;
    if (activeItem && !visible.includes(activeItem)) visible.push(activeItem);
    // The header of the section at the top of the viewport, pinned there.
    const topItem = items[firstEndingAfter(items, scrollTop)];
    const stickyLetter = topItem && scrollTop > 0 ? topItem.letter : null;

    const showRail = !query && rows.length >= 8;
    const activeId = active >= 0 && rows[active] ? optId(active) : undefined;
    const selected = selectedIndex >= 0 ? rows[selectedIndex] : sorted.find((c) => String(c.customer._id) === String(value ?? ''));

    return (
        <div
            className="cp"
            data-testid={testId}
            data-value={value ?? ''}
            data-invalid={invalid || undefined}
        >
            <div className="cp-search-wrap">
                <svg className="cp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
                </svg>
                <input
                    className="cp-search"
                    type="text"
                    inputMode="search"
                    role="searchbox"
                    aria-label={`Search clients: ${searchPlaceholder.toLowerCase()}`}
                    aria-controls={listId}
                    placeholder={searchPlaceholder}
                    value={query}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="search"
                    data-testid={`${testId}-search`}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                />
                {query ? (
                    <button type="button" className="cp-clear" aria-label="Clear search" onClick={() => setQuery('')} data-testid={`${testId}-clear`}>×</button>
                ) : null}
            </div>

            <div className="cp-body" style={{ height }}>
                <div className="cp-col">
                    <div
                        ref={listRef}
                        id={listId}
                        className="cp-list"
                        role="listbox"
                        tabIndex={0}
                        aria-label={ariaLabel}
                        aria-required={required || undefined}
                        aria-invalid={invalid || undefined}
                        aria-describedby={ariaDescribedBy}
                        aria-activedescendant={activeId}
                        data-testid={`${testId}-list`}
                        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                        onKeyDown={onListKeyDown}
                        onFocus={onListFocus}
                    >
                        {rows.length === 0 ? (
                            <div className="cp-empty" role="presentation">
                                {query ? `No clients match “${query.trim()}”` : emptyText}
                            </div>
                        ) : (
                            <div className="cp-canvas" role="presentation" style={{ height: total }}>
                                {visible.map((it) => {
                                    if (it.kind === 'head') {
                                        return (
                                            <div key={it.key} className="cp-head" aria-hidden="true" style={{ top: it.top, height: HEAD_H }}>
                                                {it.letter}
                                            </div>
                                        );
                                    }
                                    const c = it.client;
                                    const id = String(c.customer._id);
                                    const isSel = String(value ?? '') === id;
                                    const visits = Number(c.completedVisits) || 0;
                                    const last = visits ? fmtDayMonth(c.lastCompletedVisit) : null;
                                    const sub = c.customer.phone || (c.isWalkIn ? '' : c.customer.email) || '';
                                    return (
                                        <div
                                            key={it.key}
                                            id={optId(it.index)}
                                            role="option"
                                            aria-selected={isSel}
                                            aria-setsize={rows.length}
                                            aria-posinset={it.index + 1}
                                            className="cp-row"
                                            data-active={it.index === active || undefined}
                                            data-selected={isSel || undefined}
                                            data-testid={`${testId}-option-${id}`}
                                            data-letter={it.letter}
                                            style={{ top: it.top, height: ROW_H }}
                                            // While typing a search, keep focus (and the phone keyboard) in the
                                        // search box; otherwise a click focuses the list, so arrows work next.
                                        onMouseDown={(e) => { if (document.activeElement?.classList.contains('cp-search')) e.preventDefault(); }}
                                            onClick={() => pick(it.index)}
                                        >
                                            <Avatar client={c} />
                                            <span className="cp-main">
                                            <span className="cp-name">{labelOf(c)}</span>
                                            <span className="cp-sub">
                                                {c.isWalkIn ? <span className="cp-tag">Walk-in</span> : null}
                                                {sub ? <span className="cp-phone">{sub}</span> : null}
                                            </span>
                                            <span className="cp-meta">
                                                {visits ? (
                                                    <>
                                                        <span className="cp-visits">{visits} {visits === 1 ? 'visit' : 'visits'}</span>
                                                        {last ? <span className="cp-last"> · last visit {last}</span> : null}
                                                    </>
                                                ) : <span className="cp-none">No visits yet</span>}
                                            </span>
                                        </span>
                                        <span className="cp-radio" aria-hidden="true" />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    {stickyLetter ? <div className="cp-head cp-sticky" aria-hidden="true">{stickyLetter}</div> : null}
                </div>

                {showRail ? (
                    <div
                        ref={railRef}
                        className="cp-rail"
                        role="toolbar"
                        aria-orientation="vertical"
                        aria-label="Jump to letter"
                        aria-controls={listId}
                        data-testid={`${testId}-rail`}
                        onPointerDown={onRailPointerDown}
                        onPointerMove={onRailPointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onLostPointerCapture={endDrag}
                        onKeyDown={onRailKeyDown}
                    >
                        {LETTERS.map((L) => {
                            const has = !!sectionStart[L];
                            return (
                                <button
                                    key={L}
                                    type="button"
                                    className="cp-letter"
                                    data-letter={L}
                                    data-empty={!has || undefined}
                                    tabIndex={L === railFocus ? 0 : -1}
                                    aria-label={`${L === '#' ? 'Jump to names starting with a number or symbol' : `Jump to ${L}`}${has ? '' : ' (no clients)'}`}
                                    data-testid={`${testId}-letter-${L === '#' ? 'hash' : L}`}
                                    // Keyboard activation; pointer taps jump on pointerdown.
                                    onClick={(e) => { if (e.detail === 0) { setRailFocus(L); jumpTo(L); } }}
                                >
                                    {L}
                                </button>
                            );
                        })}
                    </div>
                ) : null}
                {bubble ? <div className="cp-bubble" aria-hidden="true">{targetLetter(bubble) || bubble}</div> : null}
            </div>

            <span className="cp-sr" role="status" aria-live="polite">{announce}</span>
            {selected ? (
                <div className="cp-picked" data-testid={`${testId}-picked`}>
                    Booking for <strong>{labelOf(selected)}</strong>
                </div>
            ) : null}
        </div>
    );
});

export default ClientPicker;
