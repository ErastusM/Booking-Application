// Currencies a business can price in (Bookplus is international). The frontends
// use `symbol` to format prices; the API only needs the set of valid codes.
// NAD stays the default for existing/Namibian businesses.
const CURRENCIES = [
    { code: 'NAD', symbol: 'N$', name: 'Namibian dollar' },
    { code: 'ZAR', symbol: 'R', name: 'South African rand' },
    { code: 'USD', symbol: '$', name: 'US dollar' },
    { code: 'EUR', symbol: '€', name: 'Euro' },
    { code: 'GBP', symbol: '£', name: 'British pound' },
    { code: 'BWP', symbol: 'P', name: 'Botswana pula' },
    { code: 'ZMW', symbol: 'ZK', name: 'Zambian kwacha' },
    { code: 'KES', symbol: 'KSh', name: 'Kenyan shilling' },
    { code: 'NGN', symbol: '₦', name: 'Nigerian naira' },
    { code: 'GHS', symbol: '₵', name: 'Ghanaian cedi' },
    { code: 'AUD', symbol: 'A$', name: 'Australian dollar' },
    { code: 'CAD', symbol: 'C$', name: 'Canadian dollar' },
    { code: 'INR', symbol: '₹', name: 'Indian rupee' },
    { code: 'AED', symbol: 'AED', name: 'UAE dirham' },
];

const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

module.exports = { CURRENCIES, CURRENCY_CODES };
