// Notifications are stored as plain text. Older ones were written with emoji
// and a dash after the opening words ("🎉 New booking — Ana booked…"); the app
// has no emoji, so they are shown the way new ones are written ("New booking:
// Ana booked…"). Typographic marks such as ★ ✓ × © stay.
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|\u{200D}|\u{FE0F}|\u{20E3}|\u{2726})/gu;
// ★ ☆ are typographic stars (⭐ is the emoji); newer Unicode data lists them
// as pictographic, so they are kept explicitly, like © ® ™.
const KEEP = new Set(['\u{A9}', '\u{AE}', '\u{2122}', '\u{2605}', '\u{2606}']);

export const stripEmoji = (text) => String(text ?? '').replace(EMOJI, (ch) => (KEEP.has(ch) ? ch : ''));

export const cleanNotice = (message) => {
    const raw = String(message ?? '');
    let s = stripEmoji(raw).replace(/[ \t]{2,}/g, ' ').trim();
    // "New booking — …", "Cancelled — …", "Slot refilled — …": a short opening
    // label that followed an emoji becomes "Label: …".
    if (s !== raw.trim()) s = s.replace(/^([A-Z][^—:.!?\d]{0,24}?) — /, '$1: ');
    return s;
};
