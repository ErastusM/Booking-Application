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
// What this does, only in an iPhone home-screen app (never in a browser tab,
// on Android, on a desktop or on an iPad, so none of it runs there; an iPad
// app can be a split-view, Stage Manager or resizable window, where a window
// shorter than the screen is simply its size, not this bug):
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
//     --vp-gap goes back to nothing as soon as the gap is gone. A new gap is
//     only taken when two readings a frame apart agree, so one taken while
//     things are still moving (the keyboard sliding away) never moves the bars.
// A focused text field (the keyboard shrinks the viewport), a pinch zoom or a
// gap over 120px is never taken for this; once a gap is being covered they
// leave it as it is.

export const VIEWPORT_EVENT = 'bookplus:viewport';
export const VIEWPORT_FIX_CLASS = 'ios-vp-fix';

// The status bar is ~20-59pt; anything bigger is something else (a keyboard).
const MAX_GAP = 120;
const SETTLE_MS = 300;
const POLL_MS = 1000;
// An iPhone's short side is at most ~440pt; the smallest iPad's is 744.
const PHONE_MAX = 600;
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

// The screen's height in the current orientation, or null when the window is
// not as wide as the screen (on a phone only for a moment mid-rotation). iOS
// reports screen.width/height in portrait terms whichever way it is held.
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
 * does nothing at all outside an iPhone home-screen app. Returns a function
 * that stops it and takes everything off <html> again (for tests).
 */
export function installStandaloneViewportFix(): () => void {
    if (teardown) return teardown;
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
    const win = window;
    const doc = document;
    if ((win.navigator as StandaloneNavigator).standalone !== true) return () => {};
    const screenShort = Math.min(Number(win.screen?.width), Number(win.screen?.height));
    if (!(screenShort > 0 && screenShort < PHONE_MAX)) return () => {};
    const root = doc.documentElement;

    let applied = false;
    let appliedH = 0;
    let pending = 0; // a new gap seen once, taken if the next reading agrees
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
    const setFullH = (px: number) => {
        appliedH = px;
        root.style.setProperty('--app-full-h', `${px}px`);
    };

    const setGap = (px: number) => {
        pending = 0;
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
        // A pinch zoom shrinks innerWidth/innerHeight with the visual viewport,
        // so neither the width test nor the gap means anything until it is
        // undone (visualViewport resize checks again).
        if (zoomed(win)) return;
        const fullH = fullHeight(win);
        if (fullH === null) {
            // Not as wide as the screen, so the screen's height is not this
            // window's: hold the document to no more than the window.
            if (applied && appliedH !== win.innerHeight) setFullH(win.innerHeight);
            setGap(0);
            return;
        }
        // Rotated: the document still has to cover the (new) screen height.
        if (applied && fullH !== appliedH) setFullH(fullH);
        // The keyboard shrinks the viewport too: leave things as they are until
        // the field loses focus (focusout).
        if (textFieldFocused(doc)) return;
        const missing = Math.round(fullH - win.innerHeight);
        if (!applied) {
            if (!(missing > 1 && missing <= MAX_GAP)) return;
            applied = true;
            setFullH(fullH);
            root.classList.add(VIEWPORT_FIX_CLASS);
            // Give iOS a moment to hand over the full viewport before deciding
            // whether the bars need moving.
            settle();
            return;
        }
        if (missing <= 1) { setGap(0); return; }
        // More than a status bar (the keyboard still on its way down): not
        // this gap, and no reason to drop the one being covered.
        if (missing > MAX_GAP) { pending = 0; return; }
        if (missing === currentGap) { pending = 0; return; }
        if (missing !== pending) { pending = missing; schedule(); return; }
        setGap(missing);
    }

    function settle() {
        onFrame(() => { check(); onFrame(check); });
        later(check, SETTLE_MS);
    }
    function schedule() {
        if (frame) return;
        frame = 1;
        onFrame(() => { frame = 0; check(); });
    }
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
        const hadGap = currentGap !== 0;
        currentGap = 0;
        teardown = null;
        // Code that added the old gap to its measurements measures again.
        if (hadGap) win.dispatchEvent(new CustomEvent(VIEWPORT_EVENT, { detail: { gap: 0 } }));
    };
    return teardown;
}
