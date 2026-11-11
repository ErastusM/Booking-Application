/**
 * Remove the phone and browser notification subscriptions stored before a
 * time. Used after a signing key leaked (docs/ROTATING_SECRETS.md): anyone
 * holding it could have sent any account's notifications to their own device,
 * and nobody can see that. Pass the time the API restarted with the new key:
 * anything stored since then came from a real session. The apps then show
 * notifications as off on those devices, and people turn them on again.
 *
 * In Docker, from /app on the server:
 *   docker compose exec -T server node scripts/clear_push_subscriptions.js "$(docker inspect -f '{{.State.StartedAt}}' bookplus-server)"
 */
async function clearPushSubscriptions(before) {
    const PushSubscription = require('../src/models/PushSubscription');
    const r = await PushSubscription.deleteMany({ updatedAt: { $lt: before } });
    return r.deletedCount;
}

module.exports = { clearPushSubscriptions };

if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const before = new Date(process.argv[2] || '');
        if (Number.isNaN(before.getTime())) { console.error('Usage: node scripts/clear_push_subscriptions.js <time the API restarted, e.g. 2026-10-15T09:30:00Z>'); process.exit(1); }
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        const n = await clearPushSubscriptions(before);
        console.log(`Notification subscriptions stored before ${before.toISOString()} removed: ${n}`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err.message); process.exit(1); });
}
