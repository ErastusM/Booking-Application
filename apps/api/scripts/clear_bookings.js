/**
 * Clears ALL bookings (appointments) for a fresh testing session.
 * Keeps everything else — providers, customers, services, availability, wallets, etc.
 *
 * Covers single, group and recurring appointments (all live in the appointments
 * collection). Run on the host after the latest image is deployed:
 *
 *   docker compose exec server node scripts/clear_bookings.js --yes
 *
 * (Without --yes it refuses to run. Waiting-list entries are NOT touched — pass
 *  --waitlist to also clear those.)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Appointment = require('../src/models/Appointment');

(async () => {
    if (!process.argv.includes('--yes')) {
        console.error('Refusing to clear without confirmation.');
        console.error('Run:  node scripts/clear_bookings.js --yes');
        process.exit(1);
    }
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }

    await mongoose.connect(uri);

    const before = await Appointment.countDocuments();
    const { deletedCount } = await Appointment.deleteMany({});
    console.log(`\n✅ Cleared ${deletedCount} of ${before} bookings (single, group & recurring).`);

    if (process.argv.includes('--waitlist')) {
        try {
            const WaitingList = require('../src/models/WaitingList');
            const wl = await WaitingList.deleteMany({});
            console.log(`✅ Cleared ${wl.deletedCount} waiting-list entries.`);
        } catch (e) {
            console.log('(Skipped waiting list — model not found.)');
        }
    }

    console.log('Providers, customers, services and availability are untouched.');
    await mongoose.disconnect();
    process.exit(0);
})().catch((err) => { console.error('Failed:', err); process.exit(1); });
