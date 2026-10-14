// Paying online for a booking. The API opens a PayGate PayHost session and
// returns where to send the browser: PayGate's own hosted page, reached by a
// form POST of the fields it gave (card details are only ever typed there,
// never on Bookplus). PayGate sends the browser back to the API, which sends
// it on to /booking/payment?ref=… (PaymentResult).

// Online payments show in the app once they are switched on for everyone
// (packages/config/features.mjs), or in the end-to-end test build.
import { FEATURES } from '@bookplus/config/features.mjs';

export const PAYMENTS_VISIBLE = FEATURES.paymentsEnabled || import.meta.env.VITE_PAYMENTS_PREVIEW === 'true';

const LAST_REF = 'bp_last_payment';

export const rememberPayment = (reference) => {
    try { sessionStorage.setItem(LAST_REF, reference); } catch { /* private mode */ }
};
export const lastPayment = () => {
    try { return sessionStorage.getItem(LAST_REF) || ''; } catch { return ''; }
};

/** Send the browser to PayGate's hosted payment page. */
export const goToPayGate = (payment) => {
    const url = String(payment?.redirectUrl || '');
    // Only ever an https page: the API builds this from its own settings, but
    // the browser must never be posted to anything else.
    if (!/^https:\/\//i.test(url)) throw new Error('Online payment is unavailable right now. Please try again in a few minutes.');
    rememberPayment(payment.reference);
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.style.display = 'none';
    for (const [name, value] of Object.entries(payment.fields || {})) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = String(value ?? '');
        form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
};

export const nad = (cents) => `N$${((cents || 0) / 100).toLocaleString('en-NA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
