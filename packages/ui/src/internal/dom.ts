import { useEffect, useInsertionEffect, useLayoutEffect, useRef, useState } from 'react';
import { CSS } from './styles';

// Small DOM helpers shared by the pickers and the confirm dialog. Everything is
// guarded for environments without a full browser (jsdom in unit tests has no
// matchMedia, no layout and no scrollIntoView).

export const canUseDOM = typeof window !== 'undefined' && typeof document !== 'undefined';

export const useIsoLayoutEffect = canUseDOM ? useLayoutEffect : useEffect;

// Every popup layer sits here: above the app's modals (PhotoEditor overlay is
// 2000, most sheets 1000-1400) and below toasts (3000), so a toast raised by the
// action a picker or confirm just took is still visible.
export const Z_LAYER = 2500;

// Phones get bottom sheets; anything wider gets an anchored popover. 640px is the
// breakpoint the business app already uses to turn its side panels into sheets.
export const NARROW_QUERY = '(max-width: 640px)';

const matches = (query: string): boolean =>
    canUseDOM && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;

export function useMediaQuery(query: string): boolean {
    const [value, setValue] = useState(() => matches(query));
    useEffect(() => {
        if (!canUseDOM || typeof window.matchMedia !== 'function') return undefined;
        const mql = window.matchMedia(query);
        const update = () => setValue(mql.matches);
        update();
        // Safari < 14 only has the deprecated addListener.
        if (mql.addEventListener) mql.addEventListener('change', update);
        else mql.addListener(update);
        return () => {
            if (mql.removeEventListener) mql.removeEventListener('change', update);
            else mql.removeListener(update);
        };
    }, [query]);
    return value;
}

// A precise pointer (mouse / trackpad). Used to decide whether opening a
// searchable list should focus its search box: on a phone or tablet that would
// throw the keyboard up over the list before the user has asked to type.
// Without matchMedia (jsdom) assume a desktop.
export const hasFinePointer = (): boolean =>
    canUseDOM && typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: fine)').matches : true;

// Page scroll lock for the bottom sheet and the confirm dialog. Both apps set
// overflow-x on <html>, and once <html>'s overflow isn't `visible` the viewport
// takes its scrolling from <html>, not <body> — so a lock on <body> alone does
// nothing. Lock both. The apps have their own ref-counted lock (useModalChrome);
// the two must not fight. Each element is judged on its own: one that is
// already locked when we arrive is left alone and never "restored" — otherwise
// closing a picker inside a modal would unlock the page behind the still-open
// modal — while one that isn't (a modal that only locked <body>) still gets
// locked, and released again.
let lockDepth = 0;
let restore: Array<{ style: CSSStyleDeclaration; overflow: string; gutter: string }> = [];

export function lockPageScroll(): () => void {
    if (!canUseDOM) return () => {};
    if (lockDepth === 0) {
        const root = document.documentElement;
        // Keep a desktop scrollbar's gutter while <html> is hidden, so the page
        // doesn't shift sideways under a confirm dialog. (Phones overlay their
        // scrollbars, so there it is 0.)
        const hasScrollbar = window.innerWidth - root.clientWidth > 0;
        restore = [];
        [root, document.body].forEach((el) => {
            const { style } = el;
            if (style.overflow === 'hidden') return;
            restore.push({ style, overflow: style.overflow, gutter: style.getPropertyValue('scrollbar-gutter') });
            style.overflow = 'hidden';
            if (el === root && hasScrollbar) style.setProperty('scrollbar-gutter', 'stable');
        });
    }
    lockDepth += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        lockDepth = Math.max(0, lockDepth - 1);
        if (lockDepth === 0) {
            restore.forEach(({ style, overflow, gutter }) => {
                if (style.overflow === 'hidden') style.overflow = overflow;
                if (gutter) style.setProperty('scrollbar-gutter', gutter);
                else style.removeProperty('scrollbar-gutter');
            });
            restore = [];
        }
    };
}

// Focusable elements a Tab press would visit inside `root`, in DOM order (the
// roving grids and columns expose one tabIndex=0 cell each).
const TABBABLE = 'button, [href], input, select, textarea, [tabindex]';
export function tabbables(root: HTMLElement | null): HTMLElement[] {
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) =>
        el.tabIndex >= 0
        && !(el as HTMLButtonElement).disabled
        && !(el instanceof HTMLInputElement && el.type === 'hidden')
        && !el.closest('[aria-hidden="true"], [inert]'));
}

// Inject the package stylesheet once. Inline styles cannot express :hover,
// :focus-visible, keyframes or media queries, and asking both apps to import a
// CSS file would be one more thing to forget; one <style> tag, tokens only.
let stylesInjected = false;
export function useInjectStyles(): void {
    useInsertionEffect(() => {
        if (stylesInjected || !canUseDOM) return;
        if (!document.querySelector('style[data-bookplus-ui]')) {
            const el = document.createElement('style');
            el.setAttribute('data-bookplus-ui', '');
            el.textContent = CSS;
            document.head.appendChild(el);
        }
        stylesInjected = true;
    }, []);
}

// Scroll `el` into view inside its own scrolling `list` only. Element.scrollIntoView
// also scrolls every scrollable ancestor, which for a popup that lives inside a
// scrolled modal means the page jumps. The list must be position: relative so it
// is the offsetParent.
export function scrollIntoList(list: HTMLElement | null, el: HTMLElement | null, center = false): void {
    if (!list || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (center) {
        list.scrollTop = Math.max(0, top - list.clientHeight / 2 + el.offsetHeight / 2);
    } else if (top < list.scrollTop) {
        list.scrollTop = top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
    }
}

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

// Accent/diacritic-insensitive, case-insensitive text for search ("Lüderitz"
// matches "luderitz").
export const fold = (s: string): string =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Escape handling for stacked layers. A picker often lives inside an app modal
// whose own document-level Escape listener would close the whole modal too. One
// window capture listener runs before any of those and hands Escape to the
// top-most open layer only, then stops the event dead.
type EscapeLayer = { onEscape: () => void };
const escapeStack: EscapeLayer[] = [];
let escapeListening = false;
const onWindowKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !escapeStack.length) return;
    const top = escapeStack[escapeStack.length - 1];
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    top.onEscape();
};

export function useEscapeLayer(active: boolean, onEscape: () => void): void {
    const latest = useRef(onEscape);
    latest.current = onEscape;
    useEffect(() => {
        if (!active || !canUseDOM) return undefined;
        const layer: EscapeLayer = { onEscape: () => latest.current() };
        escapeStack.push(layer);
        if (!escapeListening) {
            window.addEventListener('keydown', onWindowKeyDown, true);
            escapeListening = true;
        }
        return () => {
            const i = escapeStack.indexOf(layer);
            if (i >= 0) escapeStack.splice(i, 1);
            if (!escapeStack.length && escapeListening) {
                window.removeEventListener('keydown', onWindowKeyDown, true);
                escapeListening = false;
            }
        };
    }, [active]);
}

// Android's back button / gesture closes the top layer instead of leaving the
// page, as it did the native pickers and window.confirm. CloseWatcher
// (Chromium 120+: Chrome, Samsung Internet and the other Chromium browsers on
// Android) is the platform hook for exactly this and adds no history entry, so
// nothing has to be unwound when the layer closes itself — and nothing can race
// a navigation the confirmed action makes. Escape raises a close request too,
// but useEscapeLayer cancels that keydown first, so a layer never closes twice.
// Wherever the back step still becomes a history navigation (no CloseWatcher,
// or iOS's swipe back), the popstate closes the layer, so a confirm can't
// outlive the page it was asked from and run its action there.
interface CloseWatcherLike {
    onclose: (() => void) | null;
    destroy(): void;
}
type CloseWatcherCtor = new () => CloseWatcherLike;

export function useCloseRequest(active: boolean, onClose: () => void): void {
    const latest = useRef(onClose);
    latest.current = onClose;
    useEffect(() => {
        if (!active || !canUseDOM) return undefined;
        const fire = () => latest.current();
        let watcher: CloseWatcherLike | null = null;
        const Ctor = (window as unknown as { CloseWatcher?: CloseWatcherCtor }).CloseWatcher;
        if (typeof Ctor === 'function') {
            try {
                watcher = new Ctor();
                watcher.onclose = fire;
            } catch {
                watcher = null;
            }
        }
        window.addEventListener('popstate', fire);
        return () => {
            window.removeEventListener('popstate', fire);
            if (watcher) {
                watcher.onclose = null;
                watcher.destroy();
            }
        };
    }, [active]);
}
