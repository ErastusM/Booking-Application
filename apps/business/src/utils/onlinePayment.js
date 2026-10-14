// Money paid online for bookings, in words a business reads at a glance.

/** N$ with cents; negative amounts keep their sign (−N$6.00). */
export const nad = (cents) => {
    const n = Math.round(cents || 0);
    const s = `N$${(Math.abs(n) / 100).toLocaleString('en-NA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return n < 0 ? `−${s}` : s;
};

/**
 * "12.50" / "N$12.50" / "12,50" / "1,234.50" / "1 234,50" → cents, or null if
 * it isn't an amount. A comma followed by one or two digits at the end is the
 * decimal point; any other comma separates thousands.
 */
export const parseCents = (text) => {
    let t = String(text ?? '').replace(/N\$/i, '').replace(/[\s\u00a0]/g, '');
    if (!t.includes('.') && /,\d{1,2}$/.test(t)) t = t.replace(/,(\d{1,2})$/, '.$1');
    if (/,/.test(t) && !/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) return null;
    t = t.replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    return Math.round(parseFloat(t) * 100);
};

const STATUS = {
    initiated: 'Waiting for payment',
    pending: 'Waiting for payment',
    paid: null, // depends on the kind
    refund_pending: 'Refund on its way',
    partially_refunded: 'Partly refunded',
    refunded: 'Refunded',
    failed: 'Not paid',
    cancelled: 'Cancelled',
    expired: 'Time to pay ran out',
};

/** A payment's state for the business: "Deposit paid", "Refunded"… */
export const paymentStatusText = (p) => {
    if (!p) return '';
    if (p.status === 'paid') return p.kind === 'deposit' ? 'Deposit paid' : 'Paid in full';
    return STATUS[p.status] || p.status;
};

/** A refund the card processor did not take yet (it can be sent again). */
export const stuckRefund = (p) => (p?.refunds || []).find((r) => r.gatewayStatus === 'failed') || null;

/**
 * One line for a booking's details, or '' when nothing is paid online:
 * "N$50.00 deposit paid · N$150.00 to collect", "N$200.00 paid in full",
 * "N$50.00 paid · N$50.00 refunded", "Waiting for the client to pay".
 */
export const bookingPaymentLine = (appt) => {
    if (!appt?.paymentKind) return '';
    if (appt.status === 'pending_payment') return 'Waiting for the client to pay online';
    const paid = appt.amountPaidOnlineCents || 0;
    if (!paid) return '';
    const refunded = appt.amountRefundedOnlineCents || 0;
    const total = Math.round((appt.totalPrice || 0) * 100);
    if (refunded) return `${nad(paid)} paid · ${nad(refunded)} refunded`;
    if (appt.paymentKind === 'deposit') {
        const rest = total - paid;
        // The rest is collected only at an appointment that is still going ahead.
        return rest > 0 && ['pending', 'confirmed'].includes(appt.status) ? `${nad(paid)} deposit paid · ${nad(rest)} to collect` : `${nad(paid)} deposit paid`;
    }
    return `${nad(paid)} paid in full`;
};

/** What is left to refund on a booking paid online (the server has the final say). */
export const bookingRefundableCents = (appt) => (appt?.onlinePayment && appt.status !== 'pending_payment'
    ? Math.max(0, (appt.amountPaidOnlineCents || 0) - (appt.amountRefundedOnlineCents || 0))
    : 0);

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "every Friday, once you are owed N$100.00 or more" */
export const payoutScheduleText = (s) => {
    if (!s) return '';
    const when = s.frequency === 'monthly' ? 'once a month'
        : s.frequency === 'biweekly' ? `every second ${WEEKDAY[s.weekday ?? 5]}`
            : `every ${WEEKDAY[s.weekday ?? 5]}`;
    return s.minThresholdCents > 0 ? `${when}, once you are owed ${nad(s.minThresholdCents)} or more` : when;
};
