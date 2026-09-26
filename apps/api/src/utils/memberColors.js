/**
 * Team member calendar colours.
 *
 * The owner's own bookings are the brand orange (#f03e16). Members used to be
 * created in that same orange (the old schema default), so on the owner's
 * calendar everybody looked like the owner. Every member now gets their own
 * colour from this palette.
 *
 * The palette deliberately leaves the brand orange (and anything close to it)
 * out. Each colour is mid-tone so it works in both themes:
 *   - as a small dot, it keeps at least 3:1 against the card surface in light
 *     (#ffffff) AND dark (#141416) mode;
 *   - as the calendar card's tint (a 20% wash over the card, see staffPalette
 *     in the business app), the card text stays above 7.5:1 in both modes.
 *
 * The SAME values live in apps/business/src/utils/memberColors.js — a test
 * (memberColors.test.js) fails if the two lists drift apart.
 */
const BRAND_ORANGE = '#f03e16';

const MEMBER_PALETTE = [
    { name: 'Blue',   hex: '#1f6fe5' },
    { name: 'Green',  hex: '#16a34a' },
    { name: 'Purple', hex: '#a434c9' },
    { name: 'Teal',   hex: '#0f9486' },
    { name: 'Amber',  hex: '#b98100' },
    { name: 'Pink',   hex: '#db2777' },
    { name: 'Indigo', hex: '#5a4be0' },
    { name: 'Olive',  hex: '#7a8a17' },
    { name: 'Cyan',   hex: '#0e8fc0' },
    { name: 'Brown',  hex: '#8d5b2f' },
];
const MEMBER_COLORS = MEMBER_PALETTE.map((c) => c.hex);

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const isHexColor = (v) => typeof v === 'string' && HEX_RE.test(v.trim());
const norm = (v) => String(v || '').trim().toLowerCase();
// A colour that says nothing about who the member is: none at all, or the
// owner's orange (the old default every member was created with).
const isUnsetColor = (v) => !norm(v) || norm(v) === BRAND_ORANGE;

/**
 * The next member colour given the colours already in use: the first palette
 * colour nobody has, and once all ten are taken, cycle — the colour used the
 * fewest times, earliest in the palette on a tie. So member 11 gets Blue, 12
 * Green, and so on.
 */
const nextMemberColor = (usedColors = []) => {
    const counts = new Map(MEMBER_COLORS.map((c) => [c, 0]));
    for (const c of usedColors) {
        const k = norm(c);
        if (counts.has(k)) counts.set(k, counts.get(k) + 1);
    }
    let best = MEMBER_COLORS[0];
    for (const c of MEMBER_COLORS) if (counts.get(c) < counts.get(best)) best = c;
    return best;
};

/**
 * The colour for a member about to be added to `providerId`'s team: the next
 * one not held by an ACTIVE member of that business (archived members give
 * theirs back). `extraUsed` covers rows created earlier in the same request
 * (bulk add) so a batch doesn't hand everyone the same colour.
 */
const colorForNewMember = async (providerId, extraUsed = []) => {
    const TeamMember = require('../models/TeamMember');
    const active = await TeamMember.find({ provider: providerId, isActive: true }, 'color').lean();
    return nextMemberColor([...active.map((m) => m.color), ...extraUsed]);
};

module.exports = {
    BRAND_ORANGE, MEMBER_PALETTE, MEMBER_COLORS,
    isHexColor, isUnsetColor, nextMemberColor, colorForNewMember,
};
