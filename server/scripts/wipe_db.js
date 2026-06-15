/**
 * DANGER: wipes the ENTIRE database for a clean-slate pass.
 * Drops every collection (users, appointments, services, etc.).
 *
 * The admin account is re-seeded automatically the next time the server boots
 * (from ADMIN_EMAIL / ADMIN_PASSWORD), so set those before restarting.
 *
 *   docker compose exec server node scripts/wipe_db.js --yes
 *   docker compose restart server      # re-seeds the admin on boot
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
    if (!process.argv.includes('--yes')) {
        console.error('Refusing to wipe without confirmation.');
        console.error('Run:  node scripts/wipe_db.js --yes');
        process.exit(1);
    }
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }

    await mongoose.connect(uri);
    const name = mongoose.connection.name;
    const collections = await mongoose.connection.db.listCollections().toArray();

    let dropped = 0;
    for (const c of collections) {
        await mongoose.connection.db.collection(c.name).deleteMany({});
        dropped += 1;
        console.log(`  cleared ${c.name}`);
    }

    console.log(`\n✅ Wiped database "${name}" (${dropped} collections emptied).`);
    console.log('Now restart the server to re-seed the admin:  docker compose restart server');
    await mongoose.disconnect();
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
