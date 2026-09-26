const cron = require('node-cron');
const pino = require('pino');
const { withLock } = require('./lock');
const { RETENTION, daysAgo, monthsAgo } = require('../constants/retention');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Nightly data-retention sweep (compliance audit point 9). Enforces the periods
 * in constants/retention.js — the same numbers the Privacy Policy quotes:
 *   - in-app notifications older than NOTIFICATIONS_DAYS: deleted;
 *   - dead sessions (no refresh for SESSION_DAYS) and expired OAuth codes: cleared;
 *   - expired email-verification and password-reset tokens: cleared;
 *   - staff invite links expired for EXPIRED_INVITE_GRACE_DAYS: deleted;
 *   - guest contact details GUEST_CONTACT_MONTHS after that guest's last
 *     booking: anonymised (the booking itself stays for the business's totals).
 * Deliberately NOT here: deleting "unverified" accounts. isVerified gates
 * nothing (login never checks it), so an unverified account can be a live
 * business with services and bookings. Revisit only once verification is enforced.
 * Analytics events and booking-rejection logs expire through TTL indexes;
 * pending Google sign-ups through theirs.
 *
 * Every step is idempotent and independent — one failing never stops the rest.
 * Returns what it did (tests, and the log line).
 */
async function runRetentionSweep(now = new Date()) {
    const User = require('../models/User');
    const Appointment = require('../models/Appointment');
    const Notification = require('../models/Notification');
    const out = {};
    const step = async (name, fn) => {
        try { out[name] = await fn(); } catch (err) { out[name] = `failed: ${err.message}`; log.error({ err: err.message, step: name }, 'Retention step failed'); }
    };

    await step('notificationsDeleted', async () =>
        (await Notification.deleteMany({ createdAt: { $lt: daysAgo(RETENTION.NOTIFICATIONS_DAYS, now) } })).deletedCount);

    await step('sessionsCleared', async () =>
        (await User.updateMany(
            { updatedAt: { $lt: daysAgo(RETENTION.SESSION_DAYS, now) }, 'refreshTokenJtis.0': { $exists: true } },
            { $set: { refreshTokenJtis: [] } },
            { timestamps: false },
        )).modifiedCount);

    await step('oauthCodesCleared', async () =>
        (await User.updateMany(
            { oauthCodeExpiry: { $lt: now } },
            { $set: { oauthCode: null, oauthCodeExpiry: null } },
            { timestamps: false },
        )).modifiedCount);

    await step('verificationTokensCleared', async () =>
        (await User.updateMany(
            { verificationTokenExpiry: { $lt: now } },
            { $set: { verificationToken: null, verificationTokenExpiry: null } },
            { timestamps: false },
        )).modifiedCount);

    await step('passwordResetTokensCleared', async () =>
        (await User.updateMany(
            { passwordResetExpiry: { $lt: now } },
            { $set: { passwordResetToken: null, passwordResetExpiry: null } },
            { timestamps: false },
        )).modifiedCount);

    await step('invitesDeleted', async () => {
        const cutoff = daysAgo(RETENTION.EXPIRED_INVITE_GRACE_DAYS, now);
        const r = await User.updateMany(
            { 'staffInvites.expiresAt': { $lt: cutoff } },
            { $pull: { staffInvites: { expiresAt: { $lt: cutoff } } } },
            { timestamps: false },
        );
        return r.modifiedCount;
    });

    await step('guestContactsAnonymised', async () => {
        const cutoff = monthsAgo(RETENTION.GUEST_CONTACT_MONTHS, now);
        // Guests whose LAST booking is older than the cutoff (a recent booking
        // with the same email keeps the older ones identifiable too).
        const stale = await Appointment.aggregate([
            { $match: { customer: null, guestEmail: { $type: 'string' } } },
            { $group: { _id: '$guestEmail', last: { $max: '$appointmentDate' } } },
            { $match: { last: { $lt: cutoff } } },
        ]);
        if (!stale.length) return 0;
        const r = await Appointment.updateMany(
            { customer: null, guestEmail: { $in: stale.map((g) => g._id) } },
            {
                $set: {
                    guestName: 'Guest', guestEmail: null, guestPhone: null, notes: '', manageToken: null,
                    'guestMarketing.optIn': false,
                },
            },
        );
        return r.modifiedCount;
    });

    return out;
}

// Nightly at 03:15 (after wallet expiry at 02:30), on one instance only.
const startRetentionJob = () => {
    cron.schedule('15 3 * * *', () => withLock('data-retention-tick', 60 * 60 * 1000, async () => {
        const r = await runRetentionSweep();
        log.info({ retention: r }, 'Data-retention sweep done');
    }));
    log.info('Data-retention job scheduled (daily 03:15)');
};

module.exports = startRetentionJob;
module.exports.runRetentionSweep = runRetentionSweep;
