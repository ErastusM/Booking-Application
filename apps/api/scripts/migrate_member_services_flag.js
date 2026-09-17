/**
 * One-off migration — safe to run multiple times (idempotent).
 *
 * Make every roster row say for ITSELF whether it performs the whole menu.
 *
 * `offersAllServices` was added later, so rows created before it have the field
 * absent, and absent was read as a legacy rule: an empty services list means
 * "performs everything". That rule is indistinguishable from a NEW member who
 * deliberately performs nothing yet — both are simply `services: []` with no
 * flag once the field is missing from a query result. That ambiguity is how a
 * cleaner hired into a barbershop ended up being offered the whole barbering
 * menu on the customer booking page.
 *
 * This writes the flag explicitly on every row that lacks it, choosing the value
 * that PRESERVES what that row does today:
 *   - empty services list  -> true  (it was already being treated as "does everything")
 *   - non-empty list       -> false (it was already limited to the listed services)
 *
 * Nobody's bookability changes. What changes is that the answer is now stored
 * rather than inferred, so the legacy fallback becomes dead code for real data
 * and a member's services can only ever be their own. An owner who wants an old
 * member narrowed can now untick "performs every service" for that one person.
 *
 * Rows that already carry the flag (every member created since) are untouched,
 * so a re-run writes nothing.
 *
 * Run locally:   node scripts/migrate_member_services_flag.js
 * In Docker:     docker compose exec server node scripts/migrate_member_services_flag.js
 */
async function migrateMemberServicesFlag() {
    const TeamMember = require('../src/models/TeamMember');

    // Absent OR null — a row explicitly holding true/false is already decided.
    const missing = { offersAllServices: { $in: [null] } };

    // Empty (or absent) services list => this row was behaving as "does everything".
    const [all, limited] = await Promise.all([
        TeamMember.updateMany(
            { ...missing, $or: [{ services: { $size: 0 } }, { services: { $exists: false } }] },
            { $set: { offersAllServices: true } },
        ),
        TeamMember.updateMany(
            { ...missing, services: { $exists: true, $not: { $size: 0 } } },
            { $set: { offersAllServices: false } },
        ),
    ]);

    return { all: all.modifiedCount || 0, limited: limited.modifiedCount || 0 };
}

module.exports = { migrateMemberServicesFlag };

// CLI entry point (skipped when required by tests)
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        console.log('Connected.');
        const n = await migrateMemberServicesFlag();
        console.log(`Set offersAllServices on legacy rows: ${n.all} kept performing everything, ${n.limited} kept to their listed services.`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err); process.exit(1); });
}
