/**
 * One-off migration — safe to run multiple times (idempotent).
 *
 * Stop legacy blocked time from closing the whole team.
 *
 * A block is scoped three ways (models/BlockedTime):
 *   teamMember set              -> that member's lane only
 *   teamMember null + ownerOnly -> the OWNER's own lane only
 *   teamMember null, !ownerOnly -> business-wide: closes EVERY lane
 *
 * The `ownerOnly` flag only arrived on 2026-09-01 (#139, "Fix cross-member
 * blocked-time leak"). Before it there was no third option: an owner blocking
 * their own lunch and a genuine public-holiday closure were stored identically,
 * as `teamMember: null`. Every one of those rows still reads as business-wide,
 * so a lunch break from August keeps closing every team member's day — and a
 * RECURRING one generated rows for future dates too, so it keeps doing it every
 * week.
 *
 * This re-scopes those pre-cutoff rows to the owner alone. A team member no
 * longer inherits time that was never about them.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH:
 *   - anything with a teamMember (already correctly scoped to one person);
 *   - anything already ownerOnly;
 *   - anything created AFTER the cutoff, because from that point the owner's
 *     form has offered "Only me" / "Whole business (everyone)" / one member and
 *     defaults to "Only me" — so a business-wide row since then is a deliberate
 *     choice and must be preserved.
 *
 * THE ONE JUDGEMENT CALL, stated plainly: a genuine business-wide closure
 * created before the cutoff is indistinguishable from the owner's own time, so
 * it is converted too and will stop closing the team. Every converted row is
 * printed below so it can be re-created as a real business-wide block if it was
 * one. Erring this way is deliberate — the alternative silently costs the whole
 * team its availability, which is the bug being fixed.
 *
 * Run locally:   node scripts/migrate_blocked_time_scope.js
 * In Docker:     docker compose exec -T server node scripts/migrate_blocked_time_scope.js
 */

// The `ownerOnly` scope merged at 2026-09-01T21:42:36Z and deployed minutes
// later. Midnight UTC on the 2nd clears the deploy window: a row created in
// that gap came from the old code, which had no way to express "only me".
const CUTOFF = new Date('2026-09-02T00:00:00.000Z');

async function migrateBlockedTimeScope() {
    const BlockedTime = require('../src/models/BlockedTime');

    // Rows with NO createdAt predate `timestamps: true` on this schema, so they
    // are older still — legacy by definition.
    const legacy = {
        teamMember: null,
        ownerOnly: { $ne: true },
        $or: [{ createdAt: { $lt: CUTOFF } }, { createdAt: { $exists: false } }],
    };

    // Capture before updating so the deploy log records exactly what changed —
    // this is the audit trail for the judgement call above.
    const affected = await BlockedTime.find(legacy)
        .select('provider date startTime endTime reason isRecurring')
        .sort({ date: 1 }).lean();

    const res = await BlockedTime.updateMany(legacy, { $set: { ownerOnly: true } });

    // Business-wide rows left standing on purpose (created since the cutoff).
    const keptBusinessWide = await BlockedTime.countDocuments({
        teamMember: null, ownerOnly: { $ne: true },
    });

    return { converted: res.modifiedCount || 0, affected, keptBusinessWide };
}

module.exports = { migrateBlockedTimeScope, CUTOFF };

// CLI entry point (skipped when required by tests)
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        console.log('Connected.');
        const { converted, affected, keptBusinessWide } = await migrateBlockedTimeScope();
        console.log(`Re-scoped ${converted} legacy block(s) to the owner alone; ${keptBusinessWide} deliberate business-wide block(s) left as they are.`);
        // Bounded: a long history must not flood the deploy log.
        affected.slice(0, 50).forEach((b) => {
            console.log(`  ${b.date} ${b.startTime}-${b.endTime}${b.isRecurring ? ' (recurring)' : ''}${b.reason ? ` — ${b.reason}` : ''}`);
        });
        if (affected.length > 50) console.log(`  …and ${affected.length - 50} more.`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err); process.exit(1); });
}
