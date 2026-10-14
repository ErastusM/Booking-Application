import { describe, expect, it } from 'vitest';
import { nad, parseCents, paymentStatusText, bookingPaymentLine, bookingRefundableCents, payoutScheduleText } from './onlinePayment';

describe('onlinePayment', () => {
    it('formats and reads amounts', () => {
        expect(nad(123456)).toBe('N$1,234.56');
        expect(nad(-600)).toBe('−N$6.00');
        expect(parseCents('12.5')).toBe(1250);
        expect(parseCents('N$ 20')).toBe(2000);
        expect(parseCents('7,25')).toBe(725);
        expect(parseCents('1.234')).toBeNull();
        expect(parseCents('abc')).toBeNull();
        // As the app writes amounts (N$1,234.50), and with a decimal comma.
        expect(parseCents('1,234.50')).toBe(123450);
        expect(parseCents('N$1,234.50')).toBe(123450);
        expect(parseCents('1 234,50')).toBe(123450);
        expect(parseCents('1,234')).toBe(123400);
        expect(parseCents('12,3,4')).toBeNull();
    });

    it('says what state a payment is in', () => {
        expect(paymentStatusText({ status: 'paid', kind: 'deposit' })).toBe('Deposit paid');
        expect(paymentStatusText({ status: 'paid', kind: 'full' })).toBe('Paid in full');
        expect(paymentStatusText({ status: 'partially_refunded' })).toBe('Partly refunded');
    });

    it('describes a booking paid online in one line', () => {
        const base = { paymentKind: 'deposit', status: 'confirmed', totalPrice: 200, amountPaidOnlineCents: 5000, amountRefundedOnlineCents: 0, onlinePayment: 'p1' };
        expect(bookingPaymentLine({ totalPrice: 200 })).toBe('');
        expect(bookingPaymentLine(base)).toBe('N$50.00 deposit paid · N$150.00 to collect');
        // Nothing more to collect once it is not going ahead.
        expect(bookingPaymentLine({ ...base, status: 'no-show' })).toBe('N$50.00 deposit paid');
        expect(bookingPaymentLine({ ...base, status: 'cancelled' })).toBe('N$50.00 deposit paid');
        expect(bookingPaymentLine({ ...base, paymentKind: 'full', amountPaidOnlineCents: 20000 })).toBe('N$200.00 paid in full');
        expect(bookingPaymentLine({ ...base, amountRefundedOnlineCents: 5000, status: 'cancelled' })).toBe('N$50.00 paid · N$50.00 refunded');
        expect(bookingPaymentLine({ ...base, status: 'pending_payment', amountPaidOnlineCents: 0 })).toBe('Waiting for the client to pay online');
        expect(bookingRefundableCents(base)).toBe(5000);
        expect(bookingRefundableCents({ ...base, amountRefundedOnlineCents: 2000 })).toBe(3000);
        expect(bookingRefundableCents({ ...base, onlinePayment: null })).toBe(0);
    });

    it('says when Bookplus pays out', () => {
        expect(payoutScheduleText({ frequency: 'weekly', weekday: 5, minThresholdCents: 0 })).toBe('every Friday');
        expect(payoutScheduleText({ frequency: 'biweekly', weekday: 5, minThresholdCents: 5000 })).toBe('every second Friday, once you are owed N$50.00 or more');
        expect(payoutScheduleText({ frequency: 'monthly' })).toBe('once a month');
    });
});
