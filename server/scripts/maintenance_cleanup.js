/**
 * One-off maintenance — safe to run multiple times.
 *   1. Dedupe Notification docs: collapse identical (user, message) to the earliest.
 *   2. Backfill Appointment.provider from the service for older waiting-list
 *      promotions created without a provider (these caused 403s on status update
 *      and were missing from the provider calendar).
 *
 * Run locally:   node scripts/maintenance_cleanup.js
 * In Docker:     docker compose exec server node scripts/maintenance_cleanup.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
    await mongoose.connect(uri);
    console.log('Connected.');

    const Notification = require('../src/models/Notification');
    const Appointment = require('../src/models/Appointment');
    const Service = require('../src/models/Service');

    // 1) Dedupe notifications by (user, message), keeping the earliest _id.
    const dupes = await Notification.aggregate([
        { $group: { _id: { user: '$user', message: '$message' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
    ]);
    let removed = 0;
    for (const group of dupes) {
        const ids = group.ids.map(String).sort();      // ObjectId hex sorts by creation time
        const toDelete = ids.slice(1);                  // keep the earliest
        if (toDelete.length) {
            const r = await Notification.deleteMany({ _id: { $in: toDelete } });
            removed += r.deletedCount;
        }
    }
    console.log(`Notifications: ${dupes.length} duplicate groups, ${removed} removed.`);

    // 2) Backfill missing provider on appointments from their service.
    const orphans = await Appointment.find({ $or: [{ provider: null }, { provider: { $exists: false } }] }).select('_id service');
    let healed = 0;
    for (const appt of orphans) {
        const svc = appt.service ? await Service.findById(appt.service).select('provider') : null;
        if (svc?.provider) {
            await Appointment.updateOne({ _id: appt._id }, { $set: { provider: svc.provider } });
            healed += 1;
        }
    }
    console.log(`Appointments: ${orphans.length} without provider, ${healed} backfilled.`);

    await mongoose.disconnect();
    console.log('Done.');
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
