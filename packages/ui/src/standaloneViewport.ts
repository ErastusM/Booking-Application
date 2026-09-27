// iPhone home-screen app: keep the bottom bars on the real bottom edge.
//
// What iOS does: in an app added to the home screen (navigator.standalone, the
// black-translucent status bar, viewport-fit=cover), a page whose document is
// no taller than the screen gets a viewport that is short by the status-bar
// inset (~59pt on a Dynamic Island iPhone). window.innerHeight comes back as
// the screen height less that inset, and everything pinned to the bottom (the
// bottom nav, the calendar frame) sits that far above the real bottom edge,
// over a strip of bare <html> background. A page taller than the screen (one
// that scrolls, like the Services tab) gets the full screen and is flush.
//
// What this does, only in an iPhone or iPad home-screen app that fills the
// screen's width (never in a browser tab, on Android, on a desktop or in iPad
// split view, so none of it runs there):
//  1. When the short viewport is seen, <html> gets .ios-vp-fix and
//     --app-full-h (the screen's height), and the app's CSS makes the document
//     at least that tall, so every page gets what the long ones get. It stays
//     on for the rest of the session (only the height follows rotation):
//     taking it off once the gap closes would bring the gap straight back.
//  2. If the viewport is still short after that (checked on the next two
//     frames and again ~300ms later), --vp-gap on <html> holds the missing
//     height. The bottom bars sit at bottom: calc(-1 * var(--vp-gap, 0px)),
//     the real screen edge, and the full-screen fills add it to their height.
//     viewportGap() gives the same number to code that measures in JS, and a
//     'bookplus:viewport' event on window says when it changed.
//  3. Checked again on resize, rotation, coming back to the app, the keyboard
//     closing and visual-viewport changes (and every second while a gap is
//     being covered, in case iOS grows the viewport without telling anyone);
//     --vp-gap goes back to nothing as soon as the gap is gone.
// A focused text field (the keyboard shrinks the viewport), a pinch zoom or a
// gap over 120px is never taken for this.

export const VIEWPORT_EVENT = 'bookplus:viewport';
export const VIEWPORT_FIX_CLASS = 'ios-vp-fix';

// The status bar is ~20-59pt; anything bigger is something else (a keyboard).
const MAX_GAP = 120;
const SETTLE_MS = 300;
const POLL_MS = 1000;
// Inputs that never bring up the keyboard.
const NO_KEYBOARD = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

type StandaloneNavigator = Navigator & { standalone?: boolean };

let currentGap = 0;
let teardown: (() => void) | null = null;

/** Pixels the viewport is currently short of the screen (0 almost always). */
export function viewportGap(): number {
    return currentGap;
}

function textFieldFocused(doc: Document): boolean {
    const el = doc.activeElement as HTMLElement | null;
    if (!el || el === doc.body || el === doc.documentElement) return false;
    const editable = el.getAttribute('contenteditable');
    if (el.isContentEditable || (editable !== null && editable !== 'false')) return true;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    return el.tagName === 'INPUT' && !NO_KEYBOARD.has(((el as HTMLInputElement).type || 'text').toLowerCase());
}

function zoomed(win: Window): boolean {
    const scale = win.visualViewport?.scale;
    return typeof scale === 'number' && Math.abs(scale - 1) > 0.01;
}

// The screen's height in the current orientation, or null when the app is not
// as wide as the screen (iPad split view / slide over). iOS reports
// screen.width/height in portrait terms whichever way the phone is held.
function fullHeight(win: Window): number | null {
    const sw = Number(win.screen?.width);
    const sh = Number(win.screen?.height);
    if (!(sw > 0 && sh > 0)) return null;
    const landscape = typeof win.matchMedia === 'function'
        ? win.matchMedia('(orientation: landscape)').matches
        : win.innerWidth > win.innerHeight;
    const long = Math.max(sw, sh);
    const short = Math.min(sw, sh);
    if (Math.abs(win.innerWidth - (landscape ? long : short)) > 1) return null;
    return landscape ? short : long;
}

/**
 * Start watching for the short viewport (see above). Call once at startup;
 * does nothing at all outside an iOS home-screen app. Returns a function that
 * stops it and takes everything off <html> again (for tests).
 */
export function installStandaloneViewportFix(): () => void {
    if (teardown) return teardown;
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
    const win = window;
    const doc = document;
    if ((win.navigator as StandaloneNavigator).standalone !== true) return () => {};
    const root = doc.documentElement;

    let applied = false;
    let appliedH = 0;
    let frame = 0;
    let poll: ReturnType<typeof setInterval> | null = null;
    const frames = new Set<number>();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const onFrame = (fn: () => void) => {
        if (typeof win.requestAnimationFrame !== 'function') {
            const t = setTimeout(() => { timers.delete(t); fn(); }, 16);
            timers.add(t);
            return;
        }
        const id = win.requestAnimationFrame(() => { frames.delete(id); fn(); });
        frames.add(id);
    };
    const later = (fn: () => void, ms: number) => {
        const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
        timers.add(t);
    };

    const setGap = (px: number) => {
        const next = Math.max(0, Math.round(px));
        if (next === currentGap) return;
        currentGap = next;
        if (next) root.style.setProperty('--vp-gap', `${next}px`);
        else root.style.removeProperty('--vp-gap');
        // Only while a gap is being covered: iOS may grow the viewport back
        // without a resize event, and a stale gap would push the bars off-screen.
        if (next && !poll) poll = setInterval(check, POLL_MS);
        if (!next && poll) { clearInterval(poll); poll = null; }
        win.dispatchEvent(new CustomEvent(VIEWPORT_EVENT, { detail: { gap: next } }));
    };

    function check() {
        const fullH = fullHeight(win);
        if (fullH === null) { setGap(0); return; }
        if (applied && fullH !== appliedH) {
            // Rotated: the document still has to cover the (new) screen height.
            appliedH = fullH;
            root.style.setProperty('--app-full-h', `${fullH}px`);
        }
        // The keyboard or a pinch zoom shrinks the viewport too: leave things
        // as they are until it is gone (focusout / visualViewport resize).
        if (zoomed(win) || textFieldFocused(doc)) return;
        const missing = fullH - win.innerHeight;
        const short = missing > 1 && missing <= MAX_GAP;
        if (!applied) {
            if (!short) return;
            applied = true;
            appliedH = fullH;
            root.style.setProperty('--app-full-h', `${fullH}px`);
            root.classList.add(VIEWPORT_FIX_CLASS);
            // Give iOS a moment to hand over the full viewport before deciding
            // whether the bars need moving.
            settle();
            return;
        }
        setGap(short ? missing : 0);
    }

    function settle() {
        onFrame(() => { check(); onFrame(check); });
        later(check, SETTLE_MS);
    }
    const schedule = () => {
        if (frame) return;
        frame = 1;
        onFrame(() => { frame = 0; check(); });
    };
    const onVisible = () => { if (doc.visibilityState === 'visible') settle(); };

    const vv = win.visualViewport;
    win.addEventListener('resize', schedule);
    win.addEventListener('orientationchange', settle);
    win.addEventListener('pageshow', settle);
    doc.addEventListener('visibilitychange', onVisible);
    doc.addEventListener('focusout', schedule);
    vv?.addEventListener('resize', schedule);

    // Now (before the first render), and again once the app has painted, in
    // case iOS settles the viewport after this script runs.
    check();
    if (!applied) settle();

    teardown = () => {
        win.removeEventListener('resize', schedule);
        win.removeEventListener('orientationchange', settle);
        win.removeEventListener('pageshow', settle);
        doc.removeEventListener('visibilitychange', onVisible);
        doc.removeEventListener('focusout', schedule);
        vv?.removeEventListener('resize', schedule);
        frames.forEach((id) => win.cancelAnimationFrame?.(id));
        timers.forEach((t) => clearTimeout(t));
        if (poll) clearInterval(poll);
        root.classList.remove(VIEWPORT_FIX_CLASS);
        root.style.removeProperty('--app-full-h');
        root.style.removeProperty('--vp-gap');
        currentGap = 0;
        teardown = null;
    };
    return teardown;
}
