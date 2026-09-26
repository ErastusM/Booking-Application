import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    BRAND_ORANGE, MEMBER_PALETTE, MEMBER_COLORS, TINT_ALPHA,
    nextMemberColor, memberColorMap, staffPalette, isUnsetColor, sameColor, hexToRgb,
} from './memberColors';

// ── WCAG maths ───────────────────────────────────────────────────────────
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, bg, a) => ({ r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) });

// The card surface and card text in each theme, read from the real tokens so
// a token change can't quietly break the calendar cards.
const tokens = fs.readFileSync(path.resolve(__dirname, '../../../../packages/design-tokens/tokens.css'), 'utf8');
const block = (sel) => tokens.slice(tokens.indexOf(`${sel} {`), tokens.indexOf('}', tokens.indexOf(`${sel} {`)));
const token = (css, name) => hexToRgb(css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))[1]);
const THEMES = {
    light: { card: token(block(':root'), '--card-bg'), text: token(block(':root'), '--charcoal') },
    dark: { card: token(block('body.dark-mode'), '--card-bg'), text: token(block('body.dark-mode'), '--charcoal') },
};

describe('member palette', () => {
    it('ten distinct colours, none of them the owner\'s orange', () => {
        expect(MEMBER_PALETTE).toHaveLength(10);
        expect(new Set(MEMBER_COLORS).size).toBe(10);
        expect(MEMBER_COLORS.some((c) => sameColor(c, BRAND_ORANGE))).toBe(false);
    });

    it.each(Object.keys(THEMES))('every colour reads on a %s calendar card and as a dot', (theme) => {
        const { card, text } = THEMES[theme];
        MEMBER_PALETTE.forEach(({ name, hex }) => {
            const c = hexToRgb(hex);
            const tint = over(c, card, TINT_ALPHA);
            // The card's name line is full --charcoal; the time and service lines
            // sit at 80–85% opacity. Both stay well past AA (4.5:1) on the tint.
            expect([name, contrast(text, tint) >= 7]).toEqual([name, true]);
            expect([name, contrast(over(text, tint, 0.8), tint) >= 7]).toEqual([name, true]);
            // A small dot (filter chip, Staff lane) needs 3:1 against the surface.
            expect([name, contrast(c, card) >= 3]).toEqual([name, true]);
        });
    });
});

describe('nextMemberColor', () => {
    it('the first colour nobody has, then cycles', () => {
        expect(nextMemberColor([])).toBe(MEMBER_COLORS[0]);
        expect(nextMemberColor([MEMBER_COLORS[0], MEMBER_COLORS[1]])).toBe(MEMBER_COLORS[2]);
        expect(nextMemberColor([MEMBER_COLORS[1]])).toBe(MEMBER_COLORS[0]);
        expect(nextMemberColor(MEMBER_COLORS)).toBe(MEMBER_COLORS[0]);
        expect(nextMemberColor([...MEMBER_COLORS, MEMBER_COLORS[0]])).toBe(MEMBER_COLORS[1]);
    });
});

describe('memberColorMap', () => {
    it('uses each member\'s own colour', () => {
        const map = memberColorMap([{ _id: 'a', color: '#123456' }, { _id: 'b', color: MEMBER_COLORS[3] }]);
        expect(map).toEqual({ a: '#123456', b: MEMBER_COLORS[3] });
    });

    it('gives a member with no colour, or the old orange, a free stand-in — never orange', () => {
        const map = memberColorMap([
            { _id: 'a', color: MEMBER_COLORS[0] },
            { _id: 'b', color: '#F03E16' },
            { _id: 'c' },
            { _id: 'd', color: '' },
        ]);
        expect(map).toEqual({ a: MEMBER_COLORS[0], b: MEMBER_COLORS[1], c: MEMBER_COLORS[2], d: MEMBER_COLORS[3] });
    });

    it('is stable for the same roster', () => {
        const roster = [{ _id: 'x' }, { _id: 'y', color: MEMBER_COLORS[0] }, { _id: 'z' }];
        expect(memberColorMap(roster)).toEqual(memberColorMap(roster.map((m) => ({ ...m }))));
    });

    it('isUnsetColor', () => {
        expect(isUnsetColor(undefined)).toBe(true);
        expect(isUnsetColor(' #F03E16 ')).toBe(true);
        expect(isUnsetColor(MEMBER_COLORS[0])).toBe(false);
    });
});

describe('staffPalette', () => {
    it('tints a member colour and keeps it as the edge', () => {
        const p = staffPalette('#1f6fe5');
        expect(p.rail).toBe('#1f6fe5');
        expect(p.bg).toBe(`linear-gradient(0deg, rgba(31,111,229,${TINT_ALPHA}), rgba(31,111,229,${TINT_ALPHA})), var(--card-bg)`);
    });

    it('the owner (a CSS variable) stays orange', () => {
        const p = staffPalette('var(--gold)');
        expect(p.rail).toBe('var(--gold)');
        expect(p.bg).toContain('rgba(240,62,22,');
        expect(p.bg).not.toContain('NaN');
    });
});
