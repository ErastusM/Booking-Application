/**
 * Start business subscriptions (services/subscriptions.js): records the time
 * subscriptions started (once) and marks every business created before it as
 * kept free, until a director moves it. Businesses created after start their
 * free trial at sign-up. Safe to run on every deploy: nothing changes twice.
 *
 * In Docker: docker compose exec -T server node scripts/migrate_subscriptions.js
 */
async function migrateSubscriptions(now = new Date()) {
    const User = require('../src/models/User');
    const Subscription = require('../src/models/Subscription');
    const subs = require('../src/services/subscriptions');
    const since = await subs.startedAt(now);
    const providers = await User.find({ role: 'provider' }).select('_id createdAt').lean();
    const had = new Set((await Subscription.find({ provider: { $in: providers.map((p) => p._id) } }).select('provider').lean()).map((s) => String(s.provider)));
    let keptFree = 0;
    let trials = 0;
    for (const p of providers) {
        if (had.has(String(p._id))) continue;
        const sub = await subs.forProvider(p, now);
        if (sub.status === 'exempt') keptFree += 1; else trials += 1;
    }
    return { since, keptFree, trials, existing: had.size };
}

module.exports = { migrateSubscriptions };

if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        const r = await migrateSubscriptions();
        console.log(`migrate_subscriptions: started ${r.since.toISOString()}; ${r.keptFree} business(es) kept free, ${r.trials} on a trial, ${r.existing} already recorded.`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err.message); process.exit(1); });
}
