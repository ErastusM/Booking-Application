/**
 * One-off migration — safe to run multiple times (idempotent).
 *
 * Email + account-type auth: an email may now hold one customer account AND
 * one business account, and login is scoped per app. This migration prepares
 * existing databases for the new model:
 *   1. Backfills `User.accountType` from `role` (customer → 'customer';
 *      provider/staff/admin → 'business') on documents that predate the field.
 *   2. Drops the old global-unique `email_1` index — it would reject the
 *      second (other-type) account for an email.
 *   3. Ensures the new compound unique index { email, accountType }.
 *
 * Run locally:   node scripts/migrate_account_types.js
 * In Docker:     docker compose exec server node scripts/migrate_account_types.js
 */

async function migrateAccountTypes() {
    const User = require('../src/models/User');

    const [customers, businesses] = await Promise.all([
        User.updateMany(
            { role: 'customer', accountType: { $ne: 'customer' } },
            { $set: { accountType: 'customer' } }
        ),
        User.updateMany(
            { role: { $in: ['provider', 'staff', 'admin'] }, accountType: { $ne: 'business' } },
            { $set: { accountType: 'business' } }
        ),
    ]);

    // Drop the legacy unique index on email alone (ignore if already gone).
    let droppedOldIndex = false;
    try {
        await User.collection.dropIndex('email_1');
        droppedOldIndex = true;
    } catch (err) {
        if (err.codeName !== 'IndexNotFound' && err.code !== 27) throw err;
    }

    // Build the new compound unique index (no-op if it already exists).
    await User.collection.createIndex({ email: 1, accountType: 1 }, { unique: true });

    return {
        backfilled: customers.modifiedCount + businesses.modifiedCount,
        droppedOldIndex,
    };
}

module.exports = { migrateAccountTypes };

// CLI entry point (skipped when required by tests)
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error('MONGODB_URI is not set'); process.exit(1); }
        await mongoose.connect(uri);
        console.log('Connected.');
        const { backfilled, droppedOldIndex } = await migrateAccountTypes();
        console.log(`Backfilled accountType on ${backfilled} user(s).`);
        console.log(droppedOldIndex
            ? 'Dropped legacy unique index email_1.'
            : 'Legacy index email_1 was already gone.');
        console.log('Ensured compound unique index { email, accountType }.');
        await mongoose.disconnect();
        process.exit(0);
    })().catch((err) => { console.error(err); process.exit(1); });
}
