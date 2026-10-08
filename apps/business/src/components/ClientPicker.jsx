import React, { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { viewportGap, VIEWPORT_EVENT } from '@bookplus/ui';
import { sortClients } from '../utils/clientSort';
import { cloudinaryAvatar } from '../utils/cloudinary';

// The app's client list — a phone-contacts style roster: search box on top, one
// row per client (picture or initials, name, phone, visits, last visit),
// alphabetical section headers and an A–Z rail down the right edge that jumps
// (tap) or scrubs (drag) to a letter. Two modes, one list:
//
//   mode="pick" (default) — New Appointment's "who is this for?": each row has a
//     radio, and tapping one picks that client (onChange gets the id).
//   mode="browse" — the Clients tab: no radio; each row shows the client's total
//     spend (formatSpend) and tapping it (or Enter) opens the client (onOpen gets
//     the whole row). `value` marks the client that is open.
//
// Takes the CRM roll-up rows from GET /api/crm/clients as they are
// ({ customer: { _id, name, email, phone, avatar }, isWalkIn, completedVisits,
// lastCompletedVisit, totalSpend }). Visits are completed bookings only — not
// the roster's `visits` / `lastVisit`, which also count cancelled, no-show and
// upcoming ones — and the list keeps the app's one client order
// (utils/clientSort: A–Z, case- and accent-blind, nameless last). onChange gets
// the picked client's id; a walk-in keeps its "walkin:<name>" id, which
// utils/bookingClient turns into a name.
//
// Built for a roster of thousands on a phone: rows have fixed heights and only
// the ones near the viewport are rendered (a few dozen at a time), pictures load
// lazily, and the list scrolls inside itself (overscroll contained) so the page
// behind the modal never moves. height="fill" makes the list run from where it
// starts down to the bottom of the screen, above the phone's bottom nav.
//
// Accessibility: in pick mode the list is a single-select listbox (one tab stop,
// aria-activedescendant). In browse mode it is a list of buttons with a roving
// tab stop (one row is tabbable; focus moves with the keys). Either way arrow
// keys / Home / End / PageUp / PageDown move, Enter or Space picks / opens,
// typing a letter jumps to that letter's section (again cycles within it). The
// rail is a vertical toolbar of labelled letter buttons.

export const ROW_H = 72;
export const HEAD_H = 28;
const OVERSCAN = 6 * ROW_H;
const FALLBACK_VIEWPORT = 480; // before layout / in jsdom
const TYPEAHEAD_MS = 700;
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']);
// height="fill": never shorter than this (a small phone scrolls the page a
// little instead), and at least this far above the window's bottom edge.
const FILL_MIN = 280;
const FILL_GAP = 24;

// height="fill": the room the page keeps below the list — the padding and
// borders of the boxes it sits at the bottom of (its card, the page container),
// or, on phones and tablets, the room kept for the bottom nav and its "+" (the
// body's bottom padding, which the fixed nav floats over), whichever is more.
const spaceBelow = (el) => {
    let boxes = 0;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        boxes += (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    }
    const navRoom = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    return Math.max(boxes, navRoom, FILL_GAP);
};
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
        mode = 'pick',
        onOpen,
        formatSpend,
        className,
        // Optional: hold the search text outside (the Clients tab keeps it when
        // you switch tabs and come back).
        searchQuery,
        onSearchChange,
        // Optional (New Appointment): offer "New client" at the top of the list,
        // and "Add “<search>” as a new client" when a search finds nobody. Called
        // with the search text ('' from the top row).
        onNewClient,
    } = props;
    const browse = mode === 'browse';
    const fill = height === 'fill';

    const baseId = useId();
    const listId = `${baseId}-list`;
    const optId = (i) => `${baseId}-opt-${i}`;
    const listRef = useRef(null);
    const railRef = useRef(null);
    const typeahead = useRef({ buf: '', at: 0 });
    const dragging = useRef(false);

    const [ownQuery, setOwnQuery] = useState('');
    const query = searchQuery ?? ownQuery;
    const setQuery = (q) => (onSearchChange ? onSearchChange(q) : setOwnQuery(q));
    const [scrollTop, setScrollTopState] = useState(0);
    const scrollRef = useRef(0); // the last scrollTop we rendered for
    const setScrollTop = useCallback((y) => { scrollRef.current = y; setScrollTopState(y); }, []);
    const bodyRef = useRef(null);
    const [fillH, setFillH] = useState(null);
    // Browse mode: move DOM focus to the active row after the next render
    // (it may not be rendered until then).
    const [focusReq, setFocusReq] = useState(0);
    const requestFocus = () => setFocusReq((n) => n + 1);
    const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
    const [active, setActive] = useState(-1); // index into `rows`
    const [bubble, setBubble] = useState(null); // letter shown while scrubbing the rail
    const [announce, setAnnounce] = useState('');
    const [railFocus, setRailFocus] = useState('A');

    useImperativeHandle(ref, () => listRef.current);

    const sorted = useMemo(() => sortClients(clients || []).filter((c) => c?.customer?._id), [clients]);
    const rows = useMemo(() => sorted.filter((c) => matchesClient(c, query)), [sorted, query]);
    const noMatch = !!onNewClient && !browse && rows.length === 0 && !!query.trim();

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
        const measure = () => {
            if (!el.clientHeight) return;
            setViewport(el.clientHeight);
            // Hidden and shown again (the Clients tab hides the list while a
            // client is open on a phone), the browser forgets the scroll
            // position: put the list back where it was.
            if (Math.abs(el.scrollTop - scrollRef.current) > 1) el.scrollTop = scrollRef.current;
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // height="fill": from the top of the list to the bottom of the window, less
    // the room the page keeps below it (spaceBelow) — so the page itself doesn't
    // scroll and the rail stays clear of the bottom nav. Re-measured when anything
    // above it changes size (a banner closes), on resize / rotation, and when the
    // list is shown again. The measuring runs on the next frame so a size change
    // never re-enters the observer in the same frame (no "ResizeObserver loop"
    // errors). viewportGap() is 0 except in the iPhone home-screen app when iOS
    // leaves the window short of the screen: the bottom nav then sits that much
    // lower (on the real bottom edge), so the list runs that much further down
    // to stay just above it (@bookplus/ui standaloneViewport).
    useLayoutEffect(() => {
        if (!fill) return undefined;
        const el = bodyRef.current;
        if (!el) return undefined;
        let raf = 0;
        const measure = () => {
            raf = 0;
            if (!el.getClientRects().length) return; // display: none
            const top = el.getBoundingClientRect().top + window.scrollY;
            const h = Math.floor(window.innerHeight + viewportGap() - top - spaceBelow(el));
            setFillH(Math.max(FILL_MIN, h));
        };
        const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
        measure();
        window.addEventListener('resize', schedule);
        window.addEventListener(VIEWPORT_EVENT, schedule);
        // Something above the list changing size (a banner closing) resizes one
        // of the boxes it sits in, so watching those catches it.
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        for (let n = el; n && ro; n = n.parentElement) ro.observe(n);
        return () => {
            window.removeEventListener('resize', schedule);
            window.removeEventListener(VIEWPORT_EVENT, schedule);
            ro?.disconnect();
            if (raf) cancelAnimationFrame(raf);
        };
    }, [fill]);

    // A new search starts at the top of its results.
    useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = 0;
        setScrollTop(0);
        setActive(-1);
    }, [query, setScrollTop]);

    const scrollListTo = useCallback((y) => {
        const max = Math.max(0, total - viewport);
        const top = Math.max(0, Math.min(max, y));
        if (listRef.current) listRef.current.scrollTop = top;
        setScrollTop(top); // render the target window now, not on the scroll event
    }, [total, viewport, setScrollTop]);

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
        if (browse) { onOpen?.(c); return; }
        if (String(c.customer._id) !== String(value ?? '')) onChange?.(String(c.customer._id));
    };

    // Browse mode: focus follows the keys (the row is rendered by now).
    useLayoutEffect(() => {
        if (!focusReq || !browse || active < 0) return;
        document.getElementById(optId(active))?.focus({ preventScroll: true });
    }, [focusReq]); // eslint-disable-line react-hooks/exhaustive-deps

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
        // Browse rows are buttons: Enter / Space click the focused one natively.
        if (browse && (e.key === 'Enter' || e.key === ' ')) return;
        // Browse mode: a key that moves also moves focus to the row it lands on.
        const follow = browse && (NAV_KEYS.has(e.key) || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)));
        if (follow) requestFocus();
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

    // Into the list from the search box: the listbox takes focus (pick mode), or
    // the row itself does (browse mode).
    const enterList = (i) => {
        if (browse) requestFocus(); else listRef.current?.focus();
        moveTo(i);
    };
    const onSearchKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            enterList(active >= 0 ? active : 0);
        } else if (e.key === 'Enter') {
            e.preventDefault(); // Enter in the search box must not book the appointment
            if (rows.length === 1) pick(0);
            else if (rows.length) enterList(0);
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
    const activeId = !browse && active >= 0 && rows[active] ? optId(active) : undefined;
    // Browse mode's one tab stop: the active row, else the first row in view.
    const tabStop = active >= 0 ? active
        : (visible.find((it) => it.kind === 'row' && it.top >= scrollTop) || visible.find((it) => it.kind === 'row'))?.index ?? -1;
    const selected = selectedIndex >= 0 ? rows[selectedIndex] : sorted.find((c) => String(c.customer._id) === String(value ?? ''));

    return (
        <div
            className={className ? `cp ${className}` : 'cp'}
            data-testid={testId}
            data-mode={mode}
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

            {onNewClient && !browse && !noMatch ? (
                <button type="button" className="cp-new" onClick={() => onNewClient('')} data-testid={`${testId}-new`}>
                    <span className="cp-new-icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    </span>
                    <span className="cp-main">
                        <span className="cp-new-title">New client</span>
                        <span className="cp-new-sub">Add someone who isn't on your list yet</span>
                    </span>
                </button>
            ) : null}

            <div ref={bodyRef} className="cp-body" style={noMatch ? { height: 'auto', minHeight: 0 } : { height: fill ? (fillH ?? 'min(60dvh, 560px)') : height }}>
                <div className="cp-col">
                    <div
                        ref={listRef}
                        id={listId}
                        className="cp-list"
                        role={browse ? 'list' : 'listbox'}
                        tabIndex={browse ? undefined : 0}
                        aria-label={ariaLabel}
                        aria-required={(!browse && required) || undefined}
                        aria-invalid={(!browse && invalid) || undefined}
                        aria-describedby={ariaDescribedBy}
                        aria-activedescendant={activeId}
                        data-testid={`${testId}-list`}
                        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                        onKeyDown={onListKeyDown}
                        onFocus={browse ? undefined : onListFocus}
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
                                    const sub = c.customer.phone || c.customer.email || '';
                                    const details = (
                                        <>
                                            <span className="cp-sub">
                                                {c.isWalkIn ? <span className="cp-tag">{c.isGuest ? 'Guest' : 'Walk-in'}</span> : null}
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
                                        </>
                                    );
                                    if (browse) {
                                        return (
                                            <div
                                                key={it.key}
                                                role="listitem"
                                                className="cp-slot"
                                                aria-setsize={rows.length}
                                                aria-posinset={it.index + 1}
                                                style={{ top: it.top, height: ROW_H }}
                                            >
                                                <button
                                                    type="button"
                                                    id={optId(it.index)}
                                                    className="cp-row"
                                                    tabIndex={it.index === tabStop ? 0 : -1}
                                                    aria-current={isSel || undefined}
                                                    data-active={it.index === active || undefined}
                                                    data-selected={isSel || undefined}
                                                    data-testid={`${testId}-row-${id}`}
                                                    data-letter={it.letter}
                                                    onFocus={() => { if (active !== it.index) setActive(it.index); }}
                                                    onClick={() => pick(it.index)}
                                                >
                                                    <Avatar client={c} />
                                                    <span className="cp-main">
                                                        <span className="cp-top">
                                                            <span className="cp-name">{labelOf(c)}</span>
                                                            {formatSpend ? (
                                                                <span className="cp-spend" data-testid={`${testId}-spend-${id}`}>
                                                                    <span className="cp-sr">Total spend </span>{formatSpend(c.totalSpend)}
                                                                </span>
                                                            ) : null}
                                                        </span>
                                                        {details}
                                                    </span>
                                                </button>
                                            </div>
                                        );
                                    }
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
                                                {details}
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

            {noMatch ? (
                <div className="cp-nomatch" data-testid={`${testId}-nomatch`}>
                    <button type="button" className="btn-primary cp-nomatch-btn" onClick={() => onNewClient(query.trim())} data-testid={`${testId}-add-new`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                        Add “{query.trim()}” as a new client
                    </button>
                    <p className="cp-nomatch-hint">You'll add their phone number next.</p>
                </div>
            ) : null}

            <span className="cp-sr" role="status" aria-live="polite">{announce}</span>
            {!browse && selected ? (
                <div className="cp-picked" data-testid={`${testId}-picked`}>
                    Booking for <strong>{labelOf(selected)}</strong>
                </div>
            ) : null}
        </div>
    );
});

export default ClientPicker;
