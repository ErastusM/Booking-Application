/**
 * Bookings that are not (yet) bookings for the business: a client's online
 * booking still waiting for its payment (status pending_payment), or one whose
 * payment hold ran out or that the client abandoned before paying (cancelled,
 * reason 'payment_timeout' / 'payment_abandoned'). They hold or held
 * a slot, but the business never accepted them, so the business's calendar
 * lists, counters and client roll-ups leave them out. A calendar asking for
 * ?status=pending_payment explicitly still sees the ones awaiting payment.
 *
 * With PAYMENTS_ENABLED off no such booking exists, so the filter matches
 * nothing and every list is unchanged.
 */
const PAYMENT_TIMEOUT_REASON = 'payment_timeout';
// The client walked away from a booking before paying for it.
const PAYMENT_ABANDONED_REASON = 'payment_abandoned';

const hiddenFromBusiness = () => ({
    $nor: [
        { status: 'pending_payment' },
        { status: 'cancelled', cancellationReason: { $in: [PAYMENT_TIMEOUT_REASON, PAYMENT_ABANDONED_REASON] } },
    ],
});

module.exports = { hiddenFromBusiness, PAYMENT_TIMEOUT_REASON, PAYMENT_ABANDONED_REASON };
