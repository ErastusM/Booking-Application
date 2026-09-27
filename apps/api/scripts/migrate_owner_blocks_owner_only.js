/**
 * One-off migration — safe to run on every deploy (idempotent), and it NEVER
 * fails the deploy: every outcome exits 0.
 *
 * The owner's blocked times are the owner's alone.
 *
 * The owner's report: "The app is following the blocked times of the owner for
 * every member of the business. Moses didn't set blocked times but he's getting
 * the times of the business owner." Their decision: an owner's block NEVER
 * applies to a team member — each member is blocked only by blocks in their own
 * lane (models/BlockedTime).
 *
 * The code already reads every block with `teamMember: null` as the owner's own
 * (utils/blockedTime, staffBooking), whatever its `ownerOnly` flag says, and the
 * block form no longer offers "Everyone". This makes the stored rows say the
 * same thing: every block with `teamMember: null` and `ownerOnly` not true —
 * the old "business-wide" rows — gets `ownerOnly: true`. Nothing else changes:
 * a member's own blocks and rows already ownerOnly are left alone, so a second
 * run changes nothing.
 *
 * It prints how many rows it changed per business (a business id and a count —
 * never a reason text, which can hold personal details), and a one-line
 * rollback listing the changed row ids.
 *
 *   --dry-run   count and list what WOULD change, write nothing.
 *
 * Run locally:   node scripts/migrate_owner_blocks_owner_only.js [--dry-run]
 * In Docker:     docker compose exec -T server node scripts/migrate_owner_blocks_owner_only.js
 */

// A legacy "business-wide" row: the owner's block that isn't flagged as theirs.
const LEGACY = { teamMember: null, ownerOnly: { $ne: true } };

async function migrateOwnerBlocksOwnerOnly({ dryRun = false } = {}) {
    const BlockedTime = require('../src/models/BlockedTime');
    const rows = await BlockedTime.find(LEGACY).select('_id provider').lean();
    const ids = rows.map((r) => r._id);

    const perProvider = {};
    rows.forEach((r) => {
        const k = String(r.provider);
        perProvider[k] = (perProvider[k] || 0) + 1;
    });

    let changed = 0;
    if (!dryRun && ids.length) {
        // Re-checks the condition, so a row changed meanwhile is never touched twice.
        const res = await BlockedTime.updateMany({ _id: { $in: ids }, ...LEGACY }, { $set: { ownerOnly: true } });
        changed = res.modifiedCount || 0;
    }
    return { dryRun, found: ids.length, changed, perProvider, ids: ids.map(String) };
}

// The lines the CLI prints — also what the tests read.
function report({ dryRun, found, changed, perProvider, ids }) {
    const lines = [];
    const verb = dryRun ? 'would mark' : 'marked';
    lines.push(`migrate_owner_blocks_owner_only${dryRun ? ' (dry run — nothing written)' : ''}: ${verb} ${dryRun ? found : changed} owner block(s) as the owner's own (ownerOnly:true).`);
    Object.entries(perProvider).sort((a, b) => b[1] - a[1]).forEach(([provider, n]) => {
        lines.push(`  business ${provider}: ${n}`);
    });
    if (!dryRun && changed > 0) {
        lines.push(`  Rollback: db.blockedtimes.updateMany({_id:{$in:[${ids.map((id) => `ObjectId("${id}")`).join(',')}]}},{$set:{ownerOnly:false}})`);
    }
    return lines;
}

module.exports = { migrateOwnerBlocksOwnerOnly, report };

// CLI entry point (skipped when required by tests)
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    const dryRun = process.argv.includes('--dry-run');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.log('migrate_owner_blocks_owner_only: MONGODB_URI is not set — skipped.'); return; }
        await mongoose.connect(uri);
        const r = await migrateOwnerBlocksOwnerOnly({ dryRun });
        report(r).forEach((l) => console.log(l));
        await mongoose.disconnect();
    })()
        .catch((err) => console.log(`migrate_owner_blocks_owner_only: failed (${err.message}) — blocks left as they were.`))
        .finally(() => process.exit(0));
}
