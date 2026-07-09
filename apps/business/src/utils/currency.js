// Currencies a business can price in. Keep in sync with
// apps/api/src/constants/currencies.js. NAD is the default.
export const CURRENCIES = [
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

const SYMBOLS = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.symbol]));

// The symbol for a currency code (falls back to the code, then to N$).
export const currencySymbol = (code) => SYMBOLS[(code || '').toUpperCase()] || code || 'N$';

// "N$ 120" / "$ 120" — prefixes the amount with the currency symbol.
export const formatMoney = (amount, code = 'NAD') => {
    const n = Number(amount);
    return `${currencySymbol(code)} ${Number.isFinite(n) ? n : 0}`;
};
