import { useEffect, useRef } from 'react';

// Ref-counted page scroll lock so overlapping/stacked dialogs can't leak the
// lock: the page only unlocks once the LAST open dialog releases it (restoring
// whatever overflow was set before the first one opened). Both <html> and
// <body> are locked: index.css gives <html> an overflow-x, and once <html>'s
// overflow isn't `visible` the viewport scrolls by <html>'s rules, so hiding
// only <body>'s overflow left the page free to scroll behind the dialog.
// A desktop scrollbar keeps its gutter while hidden, so the page doesn't shift
// sideways (phones overlay their scrollbars, so there is nothing to keep).
let lockCount = 0;
let saved = { html: '', body: '', gutter: '' };
const lockScroll = () => {
    if (lockCount === 0) {
        const root = document.documentElement;
        const hasScrollbar = window.innerWidth - root.clientWidth > 0;
        saved = { html: root.style.overflow, body: document.body.style.overflow, gutter: root.style.getPropertyValue('scrollbar-gutter') };
        root.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        if (hasScrollbar) root.style.setProperty('scrollbar-gutter', 'stable');
    }
    lockCount += 1;
};
const unlockScroll = () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
        const root = document.documentElement;
        root.style.overflow = saved.html;
        document.body.style.overflow = saved.body;
        if (saved.gutter) root.style.setProperty('scrollbar-gutter', saved.gutter);
        else root.style.removeProperty('scrollbar-gutter');
    }
};

// Shared modal/sheet chrome so every dialog behaves consistently:
//  • Escape closes it
//  • page scroll is locked while it's open (no scroll-behind on mobile)
//  • focus moves into the dialog on open (keyboard / screen-reader users)
// Attach the returned ref to the dialog's panel element. Give that panel
// tabIndex={-1} so it can receive focus when it has no focusable children.
export const useModalChrome = (onClose) => {
    const panelRef = useRef(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
        document.addEventListener('keydown', onKey);
        lockScroll();

        const panel = panelRef.current;
        const focusable = panel?.querySelector(
            'input:not([type="hidden"]), textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])'
        );
        (focusable || panel)?.focus?.({ preventScroll: true });

        return () => {
            document.removeEventListener('keydown', onKey);
            unlockScroll();
        };
    }, []);

    return panelRef;
};

// Keeps Tab inside a modal panel: from the last control it wraps to the first,
// and back. Call it from the panel's onKeyDown. A key pressed in something the
// panel renders elsewhere (a picker's popup, portalled to <body>) is left to it.
const TABBABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export const trapTab = (e, panel) => {
    if (e.key !== 'Tab' || !panel) return;
    const at = document.activeElement;
    if (at && at !== document.body && !panel.contains(at)) return;
    const nodes = Array.from(panel.querySelectorAll(TABBABLE));
    if (!nodes.length) { e.preventDefault(); return; }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (at === first || at === panel || at === document.body)) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && (at === last || at === document.body)) {
        e.preventDefault();
        first.focus();
    }
};
