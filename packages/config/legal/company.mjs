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
    phone: '+264 81 684 4677',
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
    ['phone', 'Phone'],
    ['email', 'Email'],
    ['privacyContact', 'Privacy contact'],
    ['privacyEmail', 'Privacy email'],
];

/** True for an empty value or a bracketed placeholder such as "[Phone number]". */
export const isPlaceholder = (value) => {
    if (value == null) return true;
    const v = String(value).trim();
    return v === '' || /\[[^\]]*\]/.test(v);
};

/** The value, or null when it is a placeholder (so it is never rendered). */
export const companyValue = (key, company = COMPANY) => (isPlaceholder(company[key]) ? null : String(company[key]).trim());

/** Labels of required fields that still hold placeholders. */
export const missingCompanyFields = (company = COMPANY) =>
    REQUIRED_FIELDS.filter(([key]) => isPlaceholder(company[key])).map(([, label]) => label);

/** The operator's name for running text: the legal name, or the trading name if that isn't set. */
export const operatorName = (company = COMPANY) => companyValue('legalName', company) || company.tradingName || 'Bookplus';
