/**
 * How long Bookplus keeps things — THE single source of truth. The Privacy Policy
 * quotes these numbers; the nightly retention job (utils/retentionService.js) and
 * the TTL indexes enforce them. Change a period here and nowhere else.
 *
 * Periods are in days. "Anonymise" means personal fields are blanked while the
 * non-personal record (date, service, price, status) is kept for the business's
 * figures.
 */
const DAY = 24 * 60 * 60 * 1000;

const RETENTION = {
    // Product-analytics events (page views, booking funnel). Only collected after
    // "Accept analytics". Deleted by a TTL index on Event.createdAt.
    ANALYTICS_EVENTS_DAYS: 180,

    // Browser crash reports: never stored in the database. They go to the server
    // log and to Sentry with every token/query value scrubbed. Server logs rotate
    // by size (docker-compose logging); Sentry's own data-retention setting must
    // be set to this in the Sentry project (owner action).
    CLIENT_ERROR_LOG_DAYS: 90,

    // In-app notifications (the bell). Deleted once older than this.
    NOTIFICATIONS_DAYS: 365,

    // Signed-in sessions: refresh tokens last 30 days, so an account untouched for
    // longer holds only dead session ids; they are cleared.
    SESSION_DAYS: 31,

    // Email-verification links (24h) and password-reset links (1h) are cleared as
    // soon as they expire. Staff invite links (7 days) are kept this long AFTER
    // expiry so "Email me a new link" still recognises the old link, then deleted.
    EXPIRED_INVITE_GRACE_DAYS: 30,

    // Guest bookings (no account): the guest's name, email, phone and notes are
    // anonymised this long after that email's LAST booking. Date, service, price
    // and status stay for the business's totals.
    GUEST_CONTACT_MONTHS: 24,

    // Failed-booking diagnostics (BookingRejection) — TTL index.
    BOOKING_REJECTION_DAYS: 7,

    // Unfinished "Continue with Google" sign-ups waiting on the Terms / age step.
    PENDING_SIGNUP_MINUTES: 30,

    // Kept (anonymised when an account is deleted) and NOT purged by the job:
    // completed bookings, wallet and account top-up transactions and their proofs
    // of payment, which are accounting records. Proposed period for the Privacy
    // Policy (owner/lawyer to confirm): 5 years.
    ACCOUNTING_RECORDS_YEARS: 5,
};

const daysAgo = (days, now = new Date()) => new Date(now.getTime() - days * DAY);
const monthsAgo = (months, now = new Date()) => { const d = new Date(now); d.setMonth(d.getMonth() - months); return d; };

module.exports = { RETENTION, DAY, daysAgo, monthsAgo };
