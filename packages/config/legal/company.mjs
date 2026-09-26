// Who operates Bookplus: the single source for the legal notice ("Who we are"),
// the Privacy Policy and the Terms in BOTH apps. Change a detail here and every
// page follows.
//
// Source: the owner's BIPA founding statement (form CC1), supplied September 2026.
//
// PLACEHOLDER GUARD. A value written in square brackets, e.g. "[Legal entity
// name]", or left empty, counts as NOT PROVIDED. Such values are never shown to
// users (the page shows "details coming soon" instead), and every production
// build prints a warning listing them (see ../vite-preset.mjs). If a detail ever
// changes and the new value isn't known yet, put a bracketed placeholder here
// rather than guessing.

export const COMPANY = {
    tradingName: 'Bookplus',
    legalName: 'Bookplus Digital Solutions CC',
    entityType: 'Close corporation registered in Namibia',
    registrationNumber: 'CC/2026/06325',
    registrationAuthority: 'Business and Intellectual Property Authority (BIPA), Namibia',
    registeredOffice: 'Erf 1442 Mahetago, Iipumbu Yashilongo Street, Swakopmund, Namibia',
    postalAddress: 'P.O. Box 906, Swakopmund, Namibia',
    // Support lines, in the order shown. Each entry is guarded on its own: a
    // placeholder entry is hidden (and warned about at build time).
    phones: ['+264 81 684 4677', '+264 81 281 9840'],
    email: 'info@bookplus.pro',
    // Privacy requests. No separate privacy@ mailbox exists, so this is the
    // general inbox. The role is the one POPIA / the Namibian Data Protection
    // Bill expect by default: the head of the business acts as information officer.
    privacyContact: 'Information Officer, Bookplus Digital Solutions CC',
    privacyEmail: 'info@bookplus.pro',
    country: 'Republic of Namibia',
};

// The fields a user must be able to see. Used by the build warning and by the
// "details coming soon" fallback.
export const REQUIRED_FIELDS = [
    ['legalName', 'Legal entity name'],
    ['entityType', 'Type of entity'],
    ['registrationNumber', 'Registration number'],
    ['registeredOffice', 'Registered office'],
    ['postalAddress', 'Postal address'],
    ['phones', 'Phone'],
    ['email', 'Email'],
    ['privacyContact', 'Privacy contact'],
    ['privacyEmail', 'Privacy email'],
];

/**
 * True for an empty value or a bracketed placeholder such as "[Phone number]".
 * A list (phones) counts as a placeholder when it is empty or ANY entry is one,
 * so the build warning catches a half-filled list.
 */
export const isPlaceholder = (value) => {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0 || value.some(isPlaceholder);
    const v = String(value).trim();
    return v === '' || /\[[^\]]*\]/.test(v);
};

/**
 * The value, or null when it is a placeholder (so it is never rendered). For a
 * list, the real entries only (null when there are none).
 */
export const companyValue = (key, company = COMPANY) => {
    const v = company[key];
    if (Array.isArray(v)) {
        const real = v.filter((x) => !isPlaceholder(x)).map((x) => String(x).trim());
        return real.length ? real : null;
    }
    return isPlaceholder(v) ? null : String(v).trim();
};

/** The support phone numbers that are actually set (placeholders removed). */
export const companyPhones = (company = COMPANY) => companyValue('phones', company) || [];

/** "tel:+264816844677" for a displayed number. */
export const telHref = (phone) => `tel:${String(phone).replace(/[^+\d]/g, '')}`;

/**
 * The phone numbers as inline links for the legal text —
 * "[+264 81 684 4677](tel:+264816844677) or [+264 81 281 9840](tel:+264812819840)" —
 * or '' when none is set.
 */
export const phoneLinks = (company = COMPANY) => {
    const links = companyPhones(company).map((p) => `[${p}](${telHref(p)})`);
    if (links.length <= 1) return links.join('');
    return `${links.slice(0, -1).join(', ')} or ${links[links.length - 1]}`;
};

/** Labels of required fields that still hold placeholders. */
export const missingCompanyFields = (company = COMPANY) =>
    REQUIRED_FIELDS.filter(([key]) => isPlaceholder(company[key])).map(([, label]) => label);

/** The operator's name for running text: the legal name, or the trading name if that isn't set. */
export const operatorName = (company = COMPANY) => companyValue('legalName', company) || company.tradingName || 'Bookplus';

/**
 * An email address as an inline link for the legal text — "[a@b.c](mailto:a@b.c)" —
 * or, when the address is missing or a placeholder, a pointer to the legal
 * notice instead, so a placeholder can never be rendered as a link.
 */
export const mailLink = (key = 'email', company = COMPANY) => {
    const v = companyValue(key, company) || (key !== 'email' ? companyValue('email', company) : null);
    return v ? `[${v}](mailto:${v})` : 'the contact details in our [Legal notice](/legal)';
};
