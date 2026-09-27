import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ChevronRight, Pencil, Plus, Search, X } from 'lucide-react';
import { formatDuration } from '@bookplus/ui';
import SearchClear from './SearchClear';
import { formatMoney } from '../utils/currency';
import { ownerPerforms, teamPerformers } from '../utils/performerServices';
import { useModalChrome, trapTab } from '../hooks/useModalChrome';

/**
 * The Services tab ("Catalogue") — ONE screen for the owner and for every team
 * member: the same header, search, category chips and contact-style rows (the
 * Clients tab's visual language), in the same order. Only the actions the
 * permission rules give each role differ:
 *
 *  - owner (role="owner"): the business's menu. Each row says who clients can
 *    book for it ("You · Moses", "Only Moses", or a warning when nobody can),
 *    and the owner manages the menu's categories from a "Categories" sheet.
 *  - team member (role="member"): THEIR services at THEIR price and time (a
 *    member never inherits the business's prices), plus "Also on …’s menu":
 *    the business's services they don't do yet, without the owner's prices.
 *
 * Presentational: the data and every action come in through props. Tapping a
 * row opens the service editor (onEdit); the editor also holds what used to
 * crowd the row — "You offer this service", Delete / Remove.
 */

export const OTHER_ID = 'other';
// The customer app's name for services with no category (BookAppointment).
export const OTHER_NAME = 'Other services';

// Case- and accent-blind text for search ("Hårklipp" matches "harklipp").
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const byName = (a, b) => fold(a.name).localeCompare(fold(b.name));
const idOf = (x) => String(x?._id ?? x ?? '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Does this service's name match the search? An empty search matches all. */
export const matchesService = (svc, query) => {
    const q = fold(query).trim();
    return !q || fold(svc?.name).includes(q);
};

/**
 * The categories a member's own services sit in (each service carries its
 * populated category), in the owner's menu order — the owner's own list is
 * the owner's to manage, so a member never loads it.
 */
export const categoriesFromServices = (services) => {
    const seen = new Map();
    (services || []).forEach((s) => {
        const c = s?.category;
        if (c && typeof c === 'object' && c._id && !seen.has(idOf(c))) seen.set(idOf(c), c);
    });
    return [...seen.values()].sort((a, b) => ((Number(a.order) || 0) - (Number(b.order) || 0))
        || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
        || fold(a.name).localeCompare(fold(b.name)));
};

/**
 * Services grouped under the menu's categories, in menu order, with the ones
 * that have no (known) category last as "Other services". Empty groups are
 * left out; each group's services are A–Z.
 */
export const groupServices = (services, categories) => {
    const known = new Set((categories || []).map(idOf));
    const buckets = new Map();
    (services || []).forEach((s) => {
        const cid = idOf(s.category);
        const key = cid && known.has(cid) ? cid : OTHER_ID;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(s);
    });
    const groups = (categories || [])
        .filter((c) => buckets.has(idOf(c)))
        .map((c) => ({ id: idOf(c), name: c.name, services: [...buckets.get(idOf(c))].sort(byName) }));
    if (buckets.has(OTHER_ID)) groups.push({ id: OTHER_ID, name: OTHER_NAME, services: [...buckets.get(OTHER_ID)].sort(byName) });
    return groups;
};

/**
 * Who clients can book for a service, as the owner's row says it. null while
 * the team is still loading (so a team-only service never flashes "Nobody").
 */
export const performersLine = (svc, teamMembers) => {
    if (!Array.isArray(teamMembers)) return null;
    const mine = ownerPerforms(svc);
    const team = teamPerformers(svc, teamMembers).map((m) => String(m.name || '').trim().split(/\s+/)[0]).filter(Boolean);
    if (!mine && team.length === 0) return { nobody: true, text: 'Nobody offers this — clients can’t book it' };
    return { nobody: false, text: mine ? ['You', ...team].join(' · ') : `Only ${team.join(' · ')}` };
};

const priceText = (price, currency) => (Number(price) > 0 ? formatMoney(price, currency) : 'Free');

// Effects that measure or move focus after the DOM is in place (no-op on a server).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function ServiceRow({ svc, isOwner, teamMembers, currency, onEdit, flash }) {
    const id = useId();
    const duration = formatDuration(svc.duration);
    const who = isOwner ? performersLine(svc, teamMembers) : null;
    const price = priceText(svc.price, currency);
    // The meta line wraps between its parts rather than cutting any of them off
    // (the non-breaking space keeps each "·" with the part before it).
    const meta = [
        <span key="d" className="sm-meta-part">{duration}</span>,
        who ? <span key="who" data-testid="catalogue-performers">{who.text}</span> : null,
        svc.location ? <span key="loc" className="sm-meta-part"><span aria-hidden="true">📍</span> {svc.location}</span> : null,
    ].filter(Boolean);
    // The same facts in words for a screen reader, after "Edit Haircut" (no
    // middle dots or pushpin read out).
    const said = [duration, who ? who.text.split(' · ').join(', ') : null, svc.location ? `in ${svc.location}` : null]
        .filter(Boolean).join(', ');
    return (
        <li className="sm-item">
            <button
                type="button"
                className="sm-row"
                aria-label={`Edit ${svc.name}`}
                aria-describedby={`${id}-said`}
                data-testid="catalogue-service"
                data-service-id={String(svc._id)}
                data-flash={flash || undefined}
                onClick={() => onEdit?.(svc)}
            >
                <span className="sm-main">
                    <span className="sm-name">{svc.name}</span>
                    <span className="sm-meta" data-nobody={who?.nobody || undefined}>
                        {meta.map((part, i) => <React.Fragment key={i}>{i > 0 ? '\u00a0· ' : ''}{part}</React.Fragment>)}
                    </span>
                </span>
                <span className="sm-price">{price}</span>
                <ChevronRight className="sm-chev" size={18} aria-hidden="true" />
            </button>
            <span id={`${id}-said`} hidden>{`${said}. ${price}`}</span>
        </li>
    );
}

/**
 * The owner's "Categories" sheet: every category on the menu (empty ones too)
 * with its number of services and a delete, plus "Add category". Escape and a
 * tap outside close it; Tab stays inside; focus goes back to the button that
 * opened it.
 */
function CategoriesSheet({ categories, counts, onClose, onAdd, onDelete, returnFocusRef }) {
    const titleId = useId();
    const panelRef = useModalChrome(onClose);
    // Where focus goes back to: the "Categories" button (passed in, since a tap
    // doesn't focus a button in Safari), else whatever had focus on opening.
    const returnTo = useRef(typeof document !== 'undefined' ? document.activeElement : null);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    // Said to screen readers; the new row itself is the visible confirmation
    // (a toast would sit over the list it is about).
    const [status, setStatus] = useState('');

    useEffect(() => () => {
        const el = returnFocusRef?.current || returnTo.current;
        if (el && el.isConnected && typeof el.focus === 'function') el.focus({ preventScroll: true });
    }, [returnFocusRef]);

    // A deleted category's row takes the focused × with it: keep focus inside
    // (only when it was lost — never taken from a confirm dialog on top).
    useEffect(() => {
        const panel = panelRef.current;
        const at = document.activeElement;
        if (panel && (!at || at === document.body)) panel.focus({ preventScroll: true });
    }, [categories, panelRef]);
    const keepFocusInside = () => {
        requestAnimationFrame(() => {
            const panel = panelRef.current;
            if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
        });
    };

    const onKeyDown = (e) => trapTab(e, panelRef.current);

    const add = async (e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n || busy) return;
        setBusy(true);
        try {
            const ok = await onAdd?.(n);
            if (ok !== false) { setName(''); setStatus(`${n} added`); }
        } finally { setBusy(false); }
    };

    const remove = async (c) => {
        const ok = await onDelete?.(c._id);
        if (ok) setStatus(`${c.name} deleted`);
        keepFocusInside();
    };

    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="sheet-overlay sm-sheet-overlay scrim-in" onClick={onClose}>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="sheet-panel scale-in sm-sheet"
                data-testid="categories-sheet"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={onKeyDown}
            >
                <div className="sm-sheet-head">
                    <h2 id={titleId} className="sm-sheet-title">Categories</h2>
                    <button type="button" className="sm-sheet-close" onClick={onClose} aria-label="Close">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>
                <p className="sm-sheet-hint">They group your services here and on your booking page. Deleting one moves its services to “{OTHER_NAME}”.</p>
                {categories.length ? (
                    <ul className="sm-sheet-list" aria-label="Menu categories">
                        {categories.map((c) => {
                            const n = counts.get(idOf(c)) || 0;
                            return (
                                <li key={idOf(c)} className="sm-cat" data-testid="category-row">
                                    <span className="sm-cat-name">{c.name}</span>
                                    <span className="sm-cat-count">{plural(n, 'service')}</span>
                                    <button type="button" className="sm-cat-del" aria-label={`Delete ${c.name}`} title="Delete category" onClick={() => remove(c)} data-testid="category-delete">
                                        <X size={18} aria-hidden="true" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="sm-sheet-empty">No categories yet.</p>
                )}
                <form className="sm-sheet-add" onSubmit={add}>
                    <input
                        className="input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="New category"
                        aria-label="New category name"
                        maxLength={60}
                        data-testid="category-name"
                    />
                    <button type="submit" className="btn-primary" disabled={!name.trim() || busy} data-testid="category-add">
                        {busy ? 'Adding…' : 'Add category'}
                    </button>
                </form>
                <p className="sr-only" role="status">{status}</p>
            </div>
        </div>,
        document.body,
    );
}

export default function ServiceMenu({
    role = 'owner',
    services = [],
    categories = [],
    teamMembers = null,
    currency = 'NAD',
    businessName = '',
    menuServices = [],
    // The service the editor is open on (its id, 'new' while adding, null when
    // closed): when it closes, focus comes back to that row (or, when it was
    // deleted, the next one) instead of the top of the page.
    editing = null,
    onAdd,
    onEdit,
    onAddFromMenu,
    onAddCategory,
    onDeleteCategory,
}) {
    const isOwner = role === 'owner';
    const [query, setQuery] = useState('');
    const [groupId, setGroupId] = useState('all');
    const [sheetOpen, setSheetOpen] = useState(false);
    const [adding, setAdding] = useState(null);
    // A row just added from the menu, briefly highlighted where it now sits.
    const [flashId, setFlashId] = useState(null);
    const [, setAddedTick] = useState(0);
    // Said to screen readers: search results, and "added" from the menu.
    const [status, setStatus] = useState('');
    const menuHeadId = useId();
    const rootRef = useRef(null);
    const titleRef = useRef(null);
    const addRef = useRef(null);
    const searchRef = useRef(null);
    const chipsRef = useRef(null);
    const manageRef = useRef(null);

    const menuCategories = useMemo(() => (isOwner ? categories || [] : categoriesFromServices(services)), [isOwner, categories, services]);
    const matching = useMemo(() => (services || []).filter((s) => matchesService(s, query)), [services, query]);
    const groups = useMemo(() => groupServices(matching, menuCategories), [matching, menuCategories]);
    // Every category's number of services, search or not (the Categories sheet).
    const counts = useMemo(() => {
        const m = new Map();
        (services || []).forEach((s) => { const id = idOf(s.category); if (id) m.set(id, (m.get(id) || 0) + 1); });
        return m;
    }, [services]);
    const menuRest = useMemo(
        () => (isOwner ? [] : (menuServices || []).filter((s) => matchesService(s, query)).sort(byName)),
        [isOwner, menuServices, query],
    );

    const total = (services || []).length;
    const q = query.trim();
    const showChips = groups.length >= 2;
    const activeId = showChips && groups.some((g) => g.id === groupId) ? groupId : 'all';
    const shown = activeId === 'all' ? groups : groups.filter((g) => g.id === activeId);
    // The role decides; the handlers only wire it up.
    const manageCategories = isOwner && typeof onAddCategory === 'function';

    const subtitle = total === 0 ? null
        : isOwner ? `${plural(total, 'service')} on your menu`
            : `${plural(total, 'service')} clients can book you for`;

    const rowFor = (id) => Array.from(rootRef.current?.querySelectorAll('[data-testid="catalogue-service"]') || [])
        .find((b) => b.dataset.serviceId === String(id));

    // Back from the editor: to the row it was opened from, or — when that
    // service is gone — the next row (else the one before, else the title).
    const rowIds = shown.flatMap((g) => g.services.map((s) => String(s._id)));
    const rowIdsRef = useRef(rowIds);
    rowIdsRef.current = rowIds;
    const openedRef = useRef(null);
    useEffect(() => {
        if (editing != null) {
            if (!openedRef.current) openedRef.current = { id: String(editing), order: rowIdsRef.current };
            return;
        }
        const was = openedRef.current;
        openedRef.current = null;
        if (!was) return;
        if (was.id === 'new') { addRef.current?.focus(); return; }
        const i = was.order.indexOf(was.id);
        const tryOrder = [was.id, ...was.order.slice(i + 1), ...was.order.slice(0, Math.max(i, 0)).reverse()];
        for (const id of tryOrder) {
            const row = rowFor(id);
            if (row) { row.focus(); return; }
        }
        titleRef.current?.focus();
    }, [editing]);

    // A service added from the menu: once its row is in the list, move focus
    // there (the "+ Add" it came from is gone), bring it on screen and
    // highlight it — the confirmation sits where the service now is.
    const pendingRef = useRef(null);
    useEffect(() => {
        const p = pendingRef.current;
        if (!p) return;
        if (Date.now() > p.until) { pendingRef.current = null; return; }
        const row = rowFor(p.id);
        if (!row) {
            // Filtered out by a category chip: show everything again.
            if (activeId !== 'all' && (services || []).some((s) => String(s._id) === p.id)) setGroupId('all');
            return;
        }
        pendingRef.current = null;
        row.focus({ preventScroll: true });
        const r = row.getBoundingClientRect();
        if (r.top < 72 || r.bottom > window.innerHeight - 72) {
            row.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        }
        setFlashId(p.id);
    });
    useEffect(() => {
        if (!flashId) return undefined;
        const t = setTimeout(() => setFlashId(null), 1600);
        return () => clearTimeout(t);
    }, [flashId]);

    const addFromMenu = async (svc) => {
        if (adding) return;
        const id = String(svc._id);
        setAdding(id);
        setStatus(`Adding ${svc.name}…`);
        let ok = false;
        try { ok = (await onAddFromMenu?.(svc)) !== false; } finally { setAdding(null); }
        if (ok) {
            pendingRef.current = { id, until: Date.now() + 4000 };
            setStatus(`${svc.name} added to your services`);
            setAddedTick((n) => n + 1);
        } else {
            setStatus('');
        }
    };

    // Search results, said once typing pauses.
    useEffect(() => {
        if (!q) return undefined;
        const t = setTimeout(() => {
            const n = matching.length;
            const more = !isOwner && menuRest.length ? `, ${menuRest.length} more on ${businessName || 'the business'}’s menu` : '';
            setStatus(`${n ? `${plural(n, 'service')} match` : 'No services match'} “${q}”${more}`);
        }, 700);
        return () => clearTimeout(t);
    }, [q, matching.length, menuRest.length, isOwner, businessName]);

    // Clearing the search removes the button that did it: keep focus in the box
    // (or on "+ Add" when the box goes too).
    const clearSearch = () => {
        flushSync(() => setQuery(''));
        (searchRef.current?.isConnected ? searchRef.current : addRef.current)?.focus();
    };

    // The chip row scrolls sideways; a fade on the side(s) with more chips says so.
    const updateFade = useCallback(() => {
        const el = chipsRef.current;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        const fade = [el.scrollLeft > 2 && 'start', el.scrollLeft < max - 2 && 'end'].filter(Boolean).join(' ');
        if (fade) el.setAttribute('data-fade', fade); else el.removeAttribute('data-fade');
    }, []);
    useIsoLayoutEffect(() => { updateFade(); });
    useEffect(() => {
        const el = chipsRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(() => updateFade());
        ro.observe(el);
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        return () => ro.disconnect();
    }, [showChips, updateFade]);
    // A chip reached with Tab (or tapped half off the edge) scrolls fully into view.
    const revealChip = (e) => e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });

    const chip = (id, name, n) => (
        <button
            key={id}
            type="button"
            className="sm-chip"
            aria-pressed={activeId === id}
            aria-label={`${name}, ${plural(n, 'service')}`}
            onClick={() => setGroupId(id)}
            onFocus={revealChip}
            data-testid="category-chip"
        >
            {name} <span className="sm-chip-count" aria-hidden="true">· {n}</span>
        </button>
    );

    return (
        <div className="sm" data-testid="service-menu" data-role={role} ref={rootRef}>
            <div className="sm-head">
                <h2 className="sm-title" ref={titleRef} tabIndex={-1}>Services</h2>
                <button ref={addRef} type="button" className="btn-primary sm-add" onClick={() => onAdd?.()} aria-label="Add service" data-testid="add-service">
                    <Plus size={16} strokeWidth={2.5} aria-hidden="true" /> Add
                </button>
            </div>
            {subtitle ? <p className="sm-sub" data-testid="service-menu-count">{subtitle}</p> : null}

            {total > 0 || menuRest.length > 0 || q ? (
                <div className="sm-search">
                    <Search className="sm-search-icon" size={16} aria-hidden="true" />
                    <input
                        ref={searchRef}
                        className="input"
                        type="text"
                        inputMode="search"
                        role="searchbox"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search services"
                        aria-label="Search services"
                        enterKeyHint="search"
                        autoComplete="off"
                        data-testid="service-search"
                    />
                    {query ? <SearchClear onClear={clearSearch} label="Clear service search" /> : null}
                </div>
            ) : null}

            {/* The category filters scroll in their own row; the owner's
                "Categories" button stays put at its end, always in full. */}
            {showChips || manageCategories ? (
                <div className="sm-chipbar">
                    {showChips ? (
                        <div ref={chipsRef} className="sm-chips" role="group" aria-label="Show a category" onScroll={updateFade}>
                            {chip('all', 'All', matching.length)}
                            {groups.map((g) => chip(g.id, g.name, g.services.length))}
                        </div>
                    ) : null}
                    {manageCategories ? (
                        <button ref={manageRef} type="button" className="sm-chip sm-chip-manage" aria-haspopup="dialog" onClick={() => setSheetOpen(true)} title="Categories" data-testid="manage-categories">
                            {/* On a phone just the pencil (the word stays for screen
                                readers), so the filters beside it get the room. */}
                            <Pencil size={15} aria-hidden="true" /> <span className="sm-chip-manage-label">Categories</span>
                        </button>
                    ) : null}
                </div>
            ) : null}

            {total === 0 && !q ? (
                <div className="sm-empty" data-testid="service-menu-empty">
                    <p className="sm-empty-title">No services yet</p>
                    <p className="sm-empty-text">Add your first service so clients can book you</p>
                    <button type="button" className="btn-primary sm-empty-btn" onClick={() => onAdd?.()}>
                        <Plus size={16} strokeWidth={2.5} aria-hidden="true" /> Add service
                    </button>
                </div>
            ) : matching.length === 0 ? (
                <div className="sm-empty" data-testid="service-menu-no-match">
                    <p className="sm-empty-title">No services match “{q}”</p>
                    <button type="button" className="btn-outline sm-empty-btn" onClick={clearSearch}>Clear search</button>
                </div>
            ) : (
                shown.map((g) => (
                    <section key={g.id} className="sm-group" data-testid="service-group">
                        <h3 className="sm-group-head" aria-label={`${g.name}, ${plural(g.services.length, 'service')}`}>{g.name} · {g.services.length}</h3>
                        <ul className="sm-card">
                            {g.services.map((s) => (
                                <ServiceRow key={s._id} svc={s} isOwner={isOwner} teamMembers={teamMembers} currency={currency} onEdit={onEdit} flash={flashId === String(s._id)} />
                            ))}
                        </ul>
                    </section>
                ))
            )}

            {/* A member takes on a service the business already sells. Its price
                here would be the owner's, so none is shown: they set their own. */}
            {!isOwner && menuRest.length > 0 ? (
                <section className="sm-menu" aria-labelledby={menuHeadId} data-testid="menu-services">
                    <h3 id={menuHeadId} className="sm-menu-title">Also on {businessName || 'the business'}’s menu</h3>
                    <p className="sm-menu-hint">Add one you also do. You can set your own price after.</p>
                    <ul className="sm-card">
                        {menuRest.map((x) => {
                            const busy = adding === String(x._id);
                            return (
                                <li key={x._id} className="sm-item">
                                    <div className="sm-row sm-row-static">
                                        <span className="sm-main">
                                            <span className="sm-name">{x.name}</span>
                                            <span className="sm-meta">{formatDuration(x.duration)}</span>
                                        </span>
                                        {/* aria-disabled, not disabled: a disabled button
                                            drops keyboard focus to the page. */}
                                        <button
                                            type="button"
                                            className="btn-outline sm-add-menu"
                                            onClick={() => addFromMenu(x)}
                                            aria-disabled={adding ? true : undefined}
                                            aria-busy={busy || undefined}
                                            aria-label={`Add ${x.name} to my services`}
                                            data-testid="menu-add-service"
                                        >
                                            {busy ? 'Adding…' : <><Plus size={14} strokeWidth={2.5} aria-hidden="true" /> Add</>}
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ) : null}

            <p className="sr-only" role="status" data-testid="service-menu-status">{status}</p>

            {sheetOpen && manageCategories ? (
                <CategoriesSheet
                    categories={categories || []}
                    counts={counts}
                    onClose={() => setSheetOpen(false)}
                    onAdd={onAddCategory}
                    onDelete={onDeleteCategory}
                    returnFocusRef={manageRef}
                />
            ) : null}
        </div>
    );
}
