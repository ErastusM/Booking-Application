/**
 * One-off migration — safe to run multiple times (idempotent).
 *
 * Multi-location foundation: every business is single-location today, so give
 * each provider exactly one primary "Main" location to anchor the new dimension.
 * A null/unset `locationId` everywhere else resolves to this primary, so once
 * every provider has one, threading `locationId` through reads can never strand
 * a booking without a home.
 *
 * Only providers that have NO location yet are touched — a provider who has
 * already created locations (via the owner CRUD) is left exactly as-is, so a
 * re-run creates nothing. The seeded address is copied from the business profile
 * as a sensible starting value; the owner can edit it.
 *
 * Run locally:   node scripts/migrate_locations.js
 * In Docker:     docker compose exec server node scripts/migrate_locations.js
 */
async function migrateLocations() {
    const User = require('../src/models/User');
    const Location = require('../src/models/Location');

    // Providers that already have at least one location — skip them entirely.
    const alreadyHas = new Set((await Location.distinct('provider')).map(String));
    const providers = await User.find({ role: 'provider' }).select('_id businessProfile').lean();
    const missing = providers.filter((p) => !alreadyHas.has(String(p._id)));

    if (missing.length) {
        await Location.insertMany(missing.map((p) => ({
            provider: p._id,
            name: 'Main',
            address: p.businessProfile?.address || '',
            isPrimary: true,
            isActive: true,
        })));
    }
    return missing.length;
}

module.exports = { migrateLocations };

// CLI entry point (skipped when required by tests)
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        console.log('Connected.');
        const n = await migrateLocations();
        console.log(`Created a primary "Main" location for ${n} provider(s) that had none.`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err); process.exit(1); });
}
