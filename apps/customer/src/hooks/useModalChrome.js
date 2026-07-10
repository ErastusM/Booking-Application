import { useEffect, useRef } from 'react';

// Ref-counted body scroll lock so overlapping/stacked dialogs can't leak the
// lock: the body only unlocks once the LAST open dialog releases it (restoring
// whatever overflow was set before the first one opened).
let lockCount = 0;
let savedOverflow = '';
const lockScroll = () => {
    if (lockCount === 0) {
        savedOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
};
const unlockScroll = () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) document.body.style.overflow = savedOverflow;
};

// Shared modal/sheet chrome so every dialog behaves consistently:
//  • Escape closes it
//  • body scroll is locked while it's open (no scroll-behind on mobile)
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
