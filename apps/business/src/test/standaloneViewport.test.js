import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installStandaloneViewportFix, viewportGap, VIEWPORT_EVENT, VIEWPORT_FIX_CLASS } from '@bookplus/ui';

/**
 * The iPhone home-screen app fix (packages/ui standaloneViewport), shared by
 * both apps. The owner's installed app showed the bottom nav ~59pt above the
 * bottom of the screen on the Clients and Calendar tabs: iOS gave those pages
 * (no taller than the screen) a viewport short by the status-bar inset. These
 * pin when the helper steps in, what it sets on <html>, and that it stays out
 * of the way everywhere else (browsers, iPad split view, the keyboard, zoom).
 *
 * jsdom has no screen, matchMedia or visualViewport worth the name, so each
 * test sets up the device it is about: a 393x852 iPhone by default, with the
 * window 59px short of the screen.
 */

const root = document.documentElement;
const PHONE = { w: 393, h: 852 };
const INSET = 59;

const define = (obj, key, value) => Object.defineProperty(obj, key, { value, configurable: true, writable: true });

function device({ standalone = true, screenW = PHONE.w, screenH = PHONE.h, innerW = PHONE.w, innerH = PHONE.h - INSET, landscape = false } = {}) {
    // 'absent': no navigator.standalone at all (every browser but iOS Safari).
    if (standalone === 'absent') delete window.navigator.standalone;
    else define(window.navigator, 'standalone', standalone);
    define(window.screen, 'width', screenW);
    define(window.screen, 'height', screenH);
    resizeWindow(innerW, innerH);
    define(window, 'matchMedia', (query) => ({
        matches: query.includes('landscape') ? landscape : !landscape,
        media: query,
        addEventListener() {},
        removeEventListener() {},
    }));
}
const resizeWindow = (w, h) => { define(window, 'innerWidth', w); define(window, 'innerHeight', h); };

const fullH = () => root.style.getPropertyValue('--app-full-h');
const gapVar = () => root.style.getPropertyValue('--vp-gap');
const fixed = () => root.classList.contains(VIEWPORT_FIX_CLASS);
// One animation frame (fake rAF runs every 16ms).
const frame = () => vi.advanceTimersByTime(16);

let stop = () => {};
let events = [];
const onViewport = (e) => events.push(e.detail.gap);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    events = [];
    window.addEventListener(VIEWPORT_EVENT, onViewport);
});

afterEach(() => {
    stop();
    stop = () => {};
    window.removeEventListener(VIEWPORT_EVENT, onViewport);
    delete window.navigator.standalone;
    delete window.visualViewport;
    document.activeElement?.blur?.();
    document.body.innerHTML = '';
    vi.useRealTimers();
});

describe('standaloneViewport — where it stays out of the way', () => {
    it('does nothing in a browser (no navigator.standalone) or a Safari tab (false)', () => {
        for (const standalone of ['absent', false]) {
            device({ standalone });
            stop = installStandaloneViewportFix();
            vi.advanceTimersByTime(2000);
            window.dispatchEvent(new Event('resize'));
            vi.advanceTimersByTime(2000);
            expect(fixed()).toBe(false);
            expect(fullH()).toBe('');
            expect(gapVar()).toBe('');
            expect(viewportGap()).toBe(0);
            expect(events).toEqual([]);
            stop();
        }
    });

    it('does nothing on an iPad in split view (the app is narrower than the screen)', () => {
        device({ screenW: 820, screenH: 1180, innerW: 507, innerH: 1180 - 24 });
        stop = installStandaloneViewportFix();
        vi.advanceTimersByTime(2000);
        expect(fixed()).toBe(false);
        expect(gapVar()).toBe('');
    });

    it('does nothing when the window already fills the screen', () => {
        device({ innerH: PHONE.h });
        stop = installStandaloneViewportFix();
        vi.advanceTimersByTime(2000);
        expect(fixed()).toBe(false);
        expect(gapVar()).toBe('');
    });

    it('never takes the keyboard for it: a focused text field is left alone until it closes', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        device({ innerH: PHONE.h - INSET });
        stop = installStandaloneViewportFix();
        vi.advanceTimersByTime(2000);
        expect(fixed()).toBe(false);

        // The keyboard closes (focus leaves the field): now it is the status-bar gap.
        input.blur();
        document.dispatchEvent(new FocusEvent('focusout'));
        frame();
        expect(fixed()).toBe(true);
    });

    it('a focused checkbox (no keyboard) does not hold it back', () => {
        const box = document.createElement('input');
        box.type = 'checkbox';
        document.body.appendChild(box);
        box.focus();
        device();
        stop = installStandaloneViewportFix();
        expect(fixed()).toBe(true);
    });

    it('ignores a gap bigger than a status bar (over 120px)', () => {
        device({ innerH: PHONE.h - 300 });
        stop = installStandaloneViewportFix();
        vi.advanceTimersByTime(2000);
        expect(fixed()).toBe(false);
        expect(gapVar()).toBe('');
    });

    it('ignores a pinch zoom', () => {
        define(window, 'visualViewport', { scale: 1.6, addEventListener() {}, removeEventListener() {} });
        device();
        stop = installStandaloneViewportFix();
        vi.advanceTimersByTime(2000);
        expect(fixed()).toBe(false);
    });
});

describe('standaloneViewport — the short viewport in the home-screen app', () => {
    it('makes the document screen-high at once: .ios-vp-fix and --app-full-h on <html>', () => {
        device();
        stop = installStandaloneViewportFix();
        expect(fixed()).toBe(true);
        expect(fullH()).toBe(`${PHONE.h}px`);
        // The bars are not moved yet: iOS gets a moment to hand over the full screen.
        expect(gapVar()).toBe('');
        expect(viewportGap()).toBe(0);
    });

    it('when iOS then gives the full screen, the bars are never moved', () => {
        device();
        stop = installStandaloneViewportFix();
        resizeWindow(PHONE.w, PHONE.h); // the taller document got the whole screen
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(2000);
        expect(fixed()).toBe(true);
        expect(gapVar()).toBe('');
        expect(viewportGap()).toBe(0);
        expect(events).toEqual([]);
    });

    it('when the gap is still there a frame later, --vp-gap holds it (and says so)', () => {
        device();
        stop = installStandaloneViewportFix();
        frame();
        expect(gapVar()).toBe(`${INSET}px`);
        expect(viewportGap()).toBe(INSET);
        expect(events).toEqual([INSET]);
        // Re-checks that find the same gap change nothing.
        vi.advanceTimersByTime(400);
        expect(events).toEqual([INSET]);
    });

    it('a gap that shows up later (a resize on a short page) is caught too', () => {
        device({ innerH: PHONE.h });
        stop = installStandaloneViewportFix();
        vi.advanceTimersByTime(400);
        expect(fixed()).toBe(false);
        resizeWindow(PHONE.w, PHONE.h - INSET);
        window.dispatchEvent(new Event('resize'));
        frame();
        expect(fixed()).toBe(true);
        expect(fullH()).toBe(`${PHONE.h}px`);
    });

    it('clears --vp-gap once the gap is gone (resize), and after a quiet change too', () => {
        device();
        stop = installStandaloneViewportFix();
        vi.advanceTimersByTime(400); // past the start-up re-checks
        expect(viewportGap()).toBe(INSET);

        resizeWindow(PHONE.w, PHONE.h);
        window.dispatchEvent(new Event('resize'));
        frame();
        expect(gapVar()).toBe('');
        expect(viewportGap()).toBe(0);
        expect(events).toEqual([INSET, 0]);

        // Short again, then full again with no event at all: the 1s check while
        // a gap is covered still takes it back off.
        resizeWindow(PHONE.w, PHONE.h - INSET);
        window.dispatchEvent(new Event('resize'));
        frame();
        expect(viewportGap()).toBe(INSET);
        resizeWindow(PHONE.w, PHONE.h);
        vi.advanceTimersByTime(1000);
        expect(viewportGap()).toBe(0);
        expect(gapVar()).toBe('');
    });

    it('does not oscillate: the class stays on once applied, whatever the gap does', () => {
        device();
        stop = installStandaloneViewportFix();
        for (const h of [PHONE.h, PHONE.h - INSET, PHONE.h, PHONE.h - INSET]) {
            resizeWindow(PHONE.w, h);
            window.dispatchEvent(new Event('resize'));
            frame();
            expect(fixed()).toBe(true);
            expect(fullH()).toBe(`${PHONE.h}px`);
        }
    });

    it('landscape measures against the short side of the screen', () => {
        // iOS reports screen.width/height in portrait terms either way round.
        device({ landscape: true, innerW: PHONE.h, innerH: PHONE.w - 40 });
        stop = installStandaloneViewportFix();
        expect(fixed()).toBe(true);
        expect(fullH()).toBe(`${PHONE.w}px`);
        frame();
        expect(viewportGap()).toBe(40);
    });

    it('rotating updates --app-full-h and drops a gap the new orientation does not have', () => {
        device();
        stop = installStandaloneViewportFix();
        frame();
        expect(viewportGap()).toBe(INSET);

        device({ landscape: true, innerW: PHONE.h, innerH: PHONE.w }); // no status bar in landscape
        window.dispatchEvent(new Event('orientationchange'));
        vi.advanceTimersByTime(400);
        expect(fixed()).toBe(true);
        expect(fullH()).toBe(`${PHONE.w}px`);
        expect(viewportGap()).toBe(0);
        expect(gapVar()).toBe('');
    });

    it('the keyboard opening later does not move anything (the last gap stands)', () => {
        device();
        stop = installStandaloneViewportFix();
        frame();
        expect(viewportGap()).toBe(INSET);
        const input = document.createElement('textarea');
        document.body.appendChild(input);
        input.focus();
        resizeWindow(PHONE.w, PHONE.h - 336); // keyboard up
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(400);
        expect(viewportGap()).toBe(INSET);
    });

    it('installing twice is one install, and stopping takes everything off <html>', () => {
        device();
        stop = installStandaloneViewportFix();
        expect(installStandaloneViewportFix()).toBe(stop);
        frame();
        expect(viewportGap()).toBe(INSET);
        stop();
        expect(fixed()).toBe(false);
        expect(fullH()).toBe('');
        expect(gapVar()).toBe('');
        expect(viewportGap()).toBe(0);
    });
});
