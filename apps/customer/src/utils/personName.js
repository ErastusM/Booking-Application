// Client names are a first name AND a surname (mirrors apps/api/src/utils/personName.js),
// so a business can tell apart clients who share one of them.
const PART = /\p{L}.*\p{L}/u; // a name part needs at least two letters

export const isNamePart = (s) => PART.test(String(s || '').trim());

export const isFullName = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length >= 2 && parts.every((p) => PART.test(p));
};

// "Ndapewa Maria Shilongo" → { first: 'Ndapewa Maria', last: 'Shilongo' }; one word → first only.
export const splitName = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { first: parts[0] || '', last: '' };
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
};

export const joinName = (first, last) => `${String(first || '').trim()} ${String(last || '').trim()}`.trim().replace(/\s+/g, ' ');
