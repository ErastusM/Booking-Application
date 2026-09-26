// The currencies a business can price in, as named in the Terms. Must list the
// same codes as apps/api/src/constants/currencies.js (the API's source of truth);
// apps/api/src/tests/unit/legalCurrencies.test.js fails if they drift apart.
export const LEGAL_CURRENCIES = [
    ['NAD', 'Namibian dollar'],
    ['ZAR', 'South African rand'],
    ['USD', 'US dollar'],
    ['EUR', 'euro'],
    ['GBP', 'British pound'],
    ['BWP', 'Botswana pula'],
    ['ZMW', 'Zambian kwacha'],
    ['KES', 'Kenyan shilling'],
    ['NGN', 'Nigerian naira'],
    ['GHS', 'Ghanaian cedi'],
    ['AUD', 'Australian dollar'],
    ['CAD', 'Canadian dollar'],
    ['INR', 'Indian rupee'],
    ['AED', 'UAE dirham'],
];

export const CURRENCY_CODES_TEXT = LEGAL_CURRENCIES.map(([code, name]) => `${name} (${code})`).join(', ');
