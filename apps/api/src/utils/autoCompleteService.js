const cron = require('node-cron');
const pino = require('pino');
const Appointment = require('../models/Appointment');
const walletService = require('./walletService');
const { withLock } = require('./lock');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

// Bookplus operates in Namibia (Africa/Windhoek, UTC+2, no DST). appointmentDate is
// stored at UTC-midnight of the booked day and endTime is the local wall-clock
// "HH:MM", so the real end instant in UTC is that date at (endTime − 2h). Computing
// in UTC keeps this independent of the server's own timezone — same convention the
// reminder job uses.
const NAMIBIA_OFFSET_MIN = 120;
const realEndMs = (appt) => {
    const d = new Date(appt.appointmentDate);
    const [h, m] = String(appt.endTime || '00:00').split(':').map(Number);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h || 0, m || 0) - NAMIBIA_OFFSET_MIN * 60 * 1000;
};

// A confirmed appointment whose end time passed at least this long ago is treated as
// completed. The grace window keeps an in-progress or just-finished appointment from
// flipping before the provider has a chance to mark it a no-show instead.
const GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Mark past confirmed appointments as completed.
 *
 * Why this exists: bookings are created `confirmed`, and nothing ever moved them to
 * `completed` unless a provider did it by hand — which in practice they didn't. That
 * left completion rate at 0%, the "completed" counts empty, and the earnings report
 * (which sums COMPLETED appointments) reading near-zero even for busy businesses.
 * Auto-completing appointments once their time has passed makes all three reflect
 * reality.
 *
 * Only `confirmed` appointments are touched (never `pending`, which was never
 * accepted). No customer emails or notifications are sent from here — this also runs
 * as a one-time backfill over historical bookings on first deploy, and firing a
 * "leave a review!" mail for every old appointment would be spam. Wallet money is
 * finalised through the same idempotent path the manual completion uses
 * (`deductForCompletion`): a no-op for cash bookings, and it turns a live wallet hold
 * into a permanent deduction exactly once.
 *
 * Returns the number of appointments completed this run.
 */
const runAutoComplete = async () => {
    const now = Date.now();
    // Coarse filter on the indexed { appointmentDate, status } — every candidate has a
    // date of today or earlier; the precise per-appointment end-instant check below is
    // what actually gates completion. After the first sweep the working set is tiny,
    // since each run drains it.
    const candidates = await Appointment.find({
        status: 'confirmed',
        appointmentDate: { $lte: new Date(now) },
    }).select('appointmentDate endTime status').lean();

    let completed = 0;
    for (const appt of candidates) {
        if (realEndMs(appt) > now - GRACE_MS) continue; // not finished (plus grace) yet

        // Claim the transition atomically so overlapping ticks can't double-complete
        // or double-move wallet money.
        const claimed = await Appointment.updateOne(
            { _id: appt._id, status: 'confirmed' },
            {
                $set: { status: 'completed' },
                $push: { statusHistory: { status: 'completed', changedBy: null, changedAt: new Date() } },
            }
        );
        if (claimed.modifiedCount !== 1) continue; // completed by another tick already

        try {
            await walletService.deductForCompletion({ appointmentId: appt._id, resolvedBy: null });
        } catch (e) {
            log.error({ appointmentId: appt._id, err: e.message }, 'auto-complete wallet finalisation failed');
        }
        completed += 1;
    }
    return completed;
};

const startAutoCompleteJob = () => {
    cron.schedule('*/30 * * * *', () => withLock('auto-complete-tick', 20 * 60 * 1000, async () => {
        try {
            const n = await runAutoComplete();
            if (n > 0) log.info({ completed: n }, 'Auto-completed past confirmed appointments');
        } catch (error) {
            log.error({ err: error.message }, 'Auto-complete cron job failed');
        }
    }));
    log.info('Auto-complete cron job started (every 30 minutes)');
};

module.exports = startAutoCompleteJob;
module.exports.runAutoComplete = runAutoComplete;
module.exports.realEndMs = realEndMs;
