/**
 * One-off migration — safe to run multiple times (idempotent).
 *
 * Reviews gained per-professional attribution (Review.teamMember / .provider),
 * set at creation from the appointment. Reviews written before that have neither
 * field, so per-professional ratings would miss all history. This backfills them
 * from each review's appointment: teamMember = appointment.teamMember (null = the
 * owner's own column), provider = appointment.provider, falling back to the
 * service's provider for older appointments with provider unset.
 *
 * Re-running is a no-op: a review already carrying the same values updates
 * nothing.
 *
 * Run locally:   node scripts/migrate_review_attribution.js
 * In Docker:     docker compose exec server node scripts/migrate_review_attribution.js
 */
async function migrateReviewAttribution() {
    const Review = require('../src/models/Review');
    const Appointment = require('../src/models/Appointment');
    const Service = require('../src/models/Service');

    // Unattributed = the provider field was never set (pre-attribution rows) or is
    // null. Almost all rows resolve on the first run; the only rows that remain
    // matched are ones whose provider genuinely can't be resolved (deleted
    // appointment AND a service with no provider) — those re-scan but write
    // nothing, so the migration stays idempotent (updated stays 0 for them).
    const cursor = Review.find({ $or: [{ provider: { $exists: false } }, { provider: null }] })
        .select('_id appointment service')
        .lean()
        .cursor();

    let updated = 0;
    for (let r = await cursor.next(); r != null; r = await cursor.next()) {
        const appt = r.appointment
            ? await Appointment.findById(r.appointment).select('teamMember provider service').lean()
            : null;
        const teamMember = appt?.teamMember || null;
        let provider = appt?.provider || null;
        if (!provider) {
            // Older appointments can have provider unset — fall back to the service's.
            const svcId = appt?.service || r.service;
            if (svcId) {
                const svc = await Service.findById(svcId).select('provider').lean();
                provider = svc?.provider || null;
            }
        }
        const res = await Review.updateOne({ _id: r._id }, { $set: { teamMember, provider } });
        if (res.modifiedCount) updated += 1;
    }
    return updated;
}

module.exports = { migrateReviewAttribution };

// CLI entry point (skipped when required by tests)
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        console.log('Connected.');
        const n = await migrateReviewAttribution();
        console.log(`Backfilled attribution on ${n} review(s).`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err); process.exit(1); });
}
