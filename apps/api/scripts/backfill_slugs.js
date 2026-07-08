/**
 * One-off migration — safe to run multiple times (idempotent).
 *
 * Gives every provider a unique public booking-link handle
 * (`businessProfile.slug`) so links like www.bookplus.pro/b/vibe-barbershop
 * resolve. New providers get a slug the first time they open their booking-link
 * step; this backfills the ones that predate the feature.
 *
 * Run locally:   node scripts/backfill_slugs.js
 * In Docker:     docker compose exec server node scripts/backfill_slugs.js
 */

async function backfillSlugs() {
    const User = require('../src/models/User');
    const { generateUniqueSlug } = require('../src/utils/slug');

    // Providers with no usable slug yet. (Customers/staff/admin never get one.)
    const providers = await User.find({
        role: 'provider',
        $or: [
            { 'businessProfile.slug': { $exists: false } },
            { 'businessProfile.slug': null },
            { 'businessProfile.slug': '' },
        ],
    }).select('name businessProfile');

    let assigned = 0;
    for (const p of providers) {
        if (!p.businessProfile) p.businessProfile = {};
        const base = p.businessProfile.businessName || p.name;
        // Sequential (not parallel) so each new slug is visible to the next
        // uniqueness check — avoids two blank-named providers racing to the same slug.
        p.businessProfile.slug = await generateUniqueSlug(base, p._id);
        p.markModified('businessProfile');
        await p.save();
        assigned += 1;
    }

    return { assigned };
}

module.exports = { backfillSlugs };

// CLI entry point (skipped when required by the boot block / tests)
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        console.log('Connected.');
        const { assigned } = await backfillSlugs();
        console.log(`Assigned booking-link slugs to ${assigned} provider(s).`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err); process.exit(1); });
}
