/**
 * Team member calendar colours — the business app's copy of the API's palette
 * (apps/api/src/utils/memberColors.js). The API gives each new member the next
 * free colour; the app shows them and lets the owner pick another from the same
 * swatches. The two lists must match: the API test memberColors.test.js fails
 * if they drift apart.
 *
 * The owner's own bookings are the brand orange (var(--gold)), so the palette
 * leaves orange out. Every colour is mid-tone: at least 3:1 as a small dot on
 * the card surface in light AND dark mode, and the calendar card text stays
 * above 7.5:1 on its tint (staffPalette below) in both.
 */
export const BRAND_ORANGE = '#f03e16';

export const MEMBER_PALETTE = [
    { name: 'Blue', hex: '#1f6fe5' },
    { name: 'Green', hex: '#16a34a' },
    { name: 'Purple', hex: '#a434c9' },
    { name: 'Teal', hex: '#0f9486' },
    { name: 'Amber', hex: '#b98100' },
    { name: 'Pink', hex: '#db2777' },
    { name: 'Indigo', hex: '#5a4be0' },
    { name: 'Olive', hex: '#7a8a17' },
    { name: 'Cyan', hex: '#0e8fc0' },
    { name: 'Brown', hex: '#8d5b2f' },
];
export const MEMBER_COLORS = MEMBER_PALETTE.map((c) => c.hex);

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const norm = (v) => String(v || '').trim().toLowerCase();
export const isHexColor = (v) => typeof v === 'string' && HEX_RE.test(v.trim());
// No colour, or the owner's orange (the old default every member was given).
export const isUnsetColor = (v) => !norm(v) || norm(v) === BRAND_ORANGE;
export const sameColor = (a, b) => norm(a) === norm(b);

/**
 * The next member colour given the colours in use: the first palette colour
 * nobody has, then cycling (least-used first, palette order on a tie). Same
 * rule as the API's nextMemberColor.
 */
export const nextMemberColor = (usedColors = []) => {
    const counts = new Map(MEMBER_COLORS.map((c) => [c, 0]));
    usedColors.forEach((c) => { const k = norm(c); if (counts.has(k)) counts.set(k, counts.get(k) + 1); });
    return MEMBER_COLORS.reduce((best, c) => (counts.get(c) < counts.get(best) ? c : best), MEMBER_COLORS[0]);
};

/**
 * Each member's display colour, keyed by member id. A member's saved colour is
 * used as is; one with no colour (or still on the owner's orange, before the
 * recolouring migration ran) gets a stand-in palette colour instead — never the
 * owner's orange — chosen the same way the API would, so it is stable and
 * distinct from their colleagues.
 */
export const memberColorMap = (members = []) => {
    const list = members.filter(Boolean);
    const used = list.filter((m) => !isUnsetColor(m.color)).map((m) => m.color);
    const out = {};
    list.forEach((m) => {
        if (!isUnsetColor(m.color)) { out[String(m._id)] = m.color; return; }
        const c = nextMemberColor(used);
        used.push(c);
        out[String(m._id)] = c;
    });
    return out;
};

// ── Calendar card tint ────────────────────────────────────────────────────
// Card text is var(--charcoal) over the staff wash; TINT_ALPHA is how much of
// the member's colour the wash carries. Checked in memberColors.test.js: at
// 0.20 every palette colour keeps the card text above 7.5:1 in both themes.
export const TINT_ALPHA = 0.2;

export const hexToRgb = (hex) => {
    // Only real hex colours parse. Non-hex values (e.g. a CSS var like
    // 'var(--gold)', which owner appointments use) return null so the caller
    // falls back — otherwise parseInt('va',16) yields NaN and the card gets an
    // invalid `rgba(NaN,…)` background (invisible in dark mode).
    const h = String(hex || '').replace('#', '').trim();
    if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) return null;
    if (h.length === 3) return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
};

// Soft, theme-safe tint from a staff colour → { bg, rail }. The wash is laid
// over an OPAQUE var(--card-bg) so the card is always the theme's own lightness
// (light in light mode, dark in dark mode) — the tint only colours it, it can
// never flip the card to the wrong ground. Non-hex (the owner's 'var(--gold)')
// tints with the brand orange and keeps the variable as the rail.
export const staffPalette = (hex) => {
    const rgb = hexToRgb(hex);
    const { r, g, b } = rgb || { r: 240, g: 62, b: 22 };
    const rail = rgb ? hex : 'var(--gold)';
    const wash = `rgba(${r},${g},${b},${TINT_ALPHA})`;
    return { bg: `linear-gradient(0deg, ${wash}, ${wash}), var(--card-bg)`, rail };
};
