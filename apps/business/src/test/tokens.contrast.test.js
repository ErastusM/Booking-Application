import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * WCAG 2.1 AA colour contrast, pinned at the source: packages/design-tokens/
 * tokens.css is the single source of truth for colour, so this test reads THAT
 * file (not a copy), resolves the light theme (:root) and the dark theme
 * (:root + body.dark-mode), and recomputes every text/usage pair the apps rely
 * on. A token edit that drops any pair below AA fails here, before it ships.
 *
 *   text (1.4.3)      4.5:1  — body-size text tokens on every surface they sit on
 *   non-text (1.4.11) 3:1    — input borders, switch tracks, the focus ring
 *
 * The brand colours (#f03e16, #040505, #e6e8e7) are fixed; only the text/usage
 * tokens are tuned to them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolve(here, '../../../../packages/design-tokens/tokens.css');
const css = readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const block = (selector) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`no "${selector}" block in tokens.css`);
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    const vars = {};
    for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
    return vars;
};

const light = block(':root');
const dark = { ...light, ...block('body.dark-mode') };

const hex = (theme, name) => {
    const v = theme[name];
    if (!v) throw new Error(`token --${name} is not defined`);
    if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`token --${name} is "${v}", expected a #rrggbb colour`);
    return v;
};
const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (h) => {
    const n = parseInt(h.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
export const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};
const val = (theme, t) => (t.startsWith('#') ? t : hex(theme, t));

// Surfaces text and controls actually sit on.
const SURFACES = ['card-bg', 'off-white', 'surface-sunken', 'input-bg'];
const TEXT = ['text-primary', 'text-secondary', 'text-muted', 'gold-dark', 'success-fg', 'info-fg', 'warning-fg', 'danger-fg'];

const pairs = (theme) => [
    ...TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg, 4.5])),
    // Status text on its own tint (badges, alerts).
    ['success-fg', 'success-bg', 4.5], ['info-fg', 'info-bg', 4.5],
    ['warning-fg', 'warning-bg', 4.5], ['danger-fg', 'danger-bg', 4.5],
    // Ink bars and orange fills: the text colour each one is paired with.
    ['on-ink', 'ink', 4.5],
    ['ink', 'gold', 4.5],
    ['#ffffff', 'danger-solid', 4.5], ['#ffffff', 'danger-solid-hover', 4.5],
    // Non-text: control boundaries, switch off-tracks and the focus ring.
    ...SURFACES.map((bg) => ['border-input', bg, 3]),
    ...['card-bg', 'off-white', 'surface-sunken'].map((bg) => ['gold-dark', bg, 3]),
    // The switch's white knob must stay visible on its off-track.
    ...(theme === light ? [['#ffffff', 'border-input', 3]] : []),
];

describe.each([['light', light], ['dark', dark]])('design tokens meet WCAG AA contrast (%s)', (_name, theme) => {
    it.each(pairs(theme).map(([fg, bg, min]) => [fg, bg, min]))('%s on %s ≥ %s:1', (fg, bg, min) => {
        const ratio = contrast(val(theme, fg), val(theme, bg));
        expect(Number(ratio.toFixed(2)), `${fg} (${val(theme, fg)}) on ${bg} (${val(theme, bg)}) is ${ratio.toFixed(2)}:1`)
            .toBeGreaterThanOrEqual(min);
    });
});

describe('the brand palette is unchanged', () => {
    it('keeps orange #f03e16, black #040505 and white #e6e8e7', () => {
        expect(light.gold.toLowerCase()).toBe('#f03e16');
        expect(light.charcoal.toLowerCase()).toBe('#040505');
        expect(light['off-white'].toLowerCase()).toBe('#e6e8e7');
    });
});

describe('contrast() itself', () => {
    it('matches the WCAG reference values', () => {
        expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
        // The audit's own numbers for the old --text-muted.
        expect(contrast('#8f9391', '#ffffff')).toBeCloseTo(3.11, 2);
        expect(contrast('#8f9391', '#e6e8e7')).toBeCloseTo(2.53, 1);
    });
});
