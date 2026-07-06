/**
 * One-off migration — safe to run multiple times (idempotent).
 *
 * Rebrand follow-up: TeamMember.color's default changed from the old brand
 * gold (#c9a84c) to brand orange (#f03e16), but existing documents keep their
 * stored value. This recolors ONLY members still on the exact old default —
 * any custom colour a provider picked is left untouched.
 *
 * Run locally:   node scripts/migrate_team_colors.js
 * In Docker:     docker compose exec server node scripts/migrate_team_colors.js
 */
const OLD_DEFAULT = /^#c9a84c$/i;
const NEW_DEFAULT = '#f03e16';

async function migrateTeamColors() {
    const TeamMember = require('../src/models/TeamMember');
    const res = await TeamMember.updateMany(
        { color: { $regex: OLD_DEFAULT } },
        { $set: { color: NEW_DEFAULT } }
    );
    return res.modifiedCount;
}

module.exports = { migrateTeamColors };

// CLI entry point (skipped when required by tests)
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        console.log('Connected.');
        const n = await migrateTeamColors();
        console.log(`Recolored ${n} team member(s) from the old gold default to ${NEW_DEFAULT}.`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err); process.exit(1); });
}
