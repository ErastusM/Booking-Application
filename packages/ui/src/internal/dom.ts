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

// Body scroll lock for the bottom sheet and the confirm dialog. The apps have
// their own ref-counted lock (useModalChrome); the two must not fight. If the
// body is already locked when we arrive, we leave it alone and never "restore"
// it — otherwise closing a picker inside a modal would unlock the page behind
// the still-open modal.
let lockDepth = 0;
let restoreTo: string | null = null;

export function lockBodyScroll(): () => void {
    if (!canUseDOM) return () => {};
    if (lockDepth === 0) {
        const { style } = document.body;
        if (style.overflow === 'hidden') {
            restoreTo = null;
        } else {
            restoreTo = style.overflow;
            style.overflow = 'hidden';
        }
    }
    lockDepth += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        lockDepth = Math.max(0, lockDepth - 1);
        if (lockDepth === 0 && restoreTo !== null) {
            if (document.body.style.overflow === 'hidden') document.body.style.overflow = restoreTo;
            restoreTo = null;
        }
    };
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
