// Canonical full names of Namibian towns. Used by the provider location picker so new
// entries are always full names, and to normalise legacy free-text (e.g. a provider who
// typed "Swkop") to the proper town name wherever a location is shown to customers.

export const NAMIBIAN_TOWNS = [
    'Windhoek', 'Swakopmund', 'Walvis Bay', 'Oshakati', 'Ondangwa', 'Rundu',
    'Otjiwarongo', 'Rehoboth', 'Gobabis', 'Katima Mulilo', 'Grootfontein',
    'Tsumeb', 'Keetmanshoop', 'Mariental', 'Okahandja', 'Henties Bay',
    'Lüderitz', 'Outjo', 'Omaruru', 'Usakos', 'Karibib', 'Eenhana', 'Opuwo',
    'Ongwediva', 'Oranjemund', 'Otavi', 'Outapi', 'Khorixas', 'Arandis',
    'Omuthiya', 'Helao Nafidi', 'Okahao', 'Ruacana', 'Divundu', 'Nkurenkuru',
    'Aranos', 'Bethanie', 'Kalkrand', 'Witvlei', 'Otjinene', 'Aus', 'Stampriet',
].sort((a, b) => a.localeCompare(b));

// Common abbreviations / shorthand → canonical full name. Keys are lowercased.
const ALIASES = {
    swkop: 'Swakopmund', swakop: 'Swakopmund', swk: 'Swakopmund',
    wdh: 'Windhoek', whk: 'Windhoek', windhuk: 'Windhoek',
    wvb: 'Walvis Bay', walvis: 'Walvis Bay', walvisbay: 'Walvis Bay',
    otji: 'Otjiwarongo',
    keetmans: 'Keetmanshoop',
    ondang: 'Ondangwa',
    oshak: 'Oshakati',
    lud: 'Lüderitz', luderitz: 'Lüderitz',
    katima: 'Katima Mulilo',
};

// Lowercase lookup of canonical names for case-insensitive exact matches.
const CANON = NAMIBIAN_TOWNS.reduce((m, t) => { m[t.toLowerCase()] = t; return m; }, {});

// Return the full town name for a free-text location, or the original trimmed value if we
// don't recognise it (e.g. a full street address) — never throws, always returns a string.
export const normalizeTown = (value) => {
    if (!value || typeof value !== 'string') return value || '';
    const key = value.trim().toLowerCase();
    if (!key) return '';
    return CANON[key] || ALIASES[key] || value.trim();
};
