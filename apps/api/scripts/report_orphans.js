/**
 * Deploy report — READ-ONLY, and it NEVER fails the deploy: every outcome exits 0.
 *
 * What earlier admin deletes left behind. Until the admin delete cleaned up
 * after itself, deleting an account removed only the User row:
 *   - a deleted business's services still pointed at it, and because the public
 *     catalogue read "no provider found" as "global service", they showed up in
 *     the marketplace (the catalogue now hides them — this counts how many);
 *   - a deleted client's bookings kept a link to an account that no longer
 *     exists, with no name of their own, so calendars showed a blank client.
 * It also counts bookings stored with customer:null and no guest or walk-in
 * name (should be none — the model refuses them — but old data may differ),
 * and "global" services (provider:null) that an admin did NOT create, which
 * would be unexpected: only the admin-create path writes provider:null.
 *
 * Counts and ids only — a service or business id, never a name, email or
 * phone. It writes nothing, so running it twice gives the same answer.
 *
 * Run locally:   node scripts/report_orphans.js
 * In Docker:     docker compose exec -T server node scripts/report_orphans.js
 */
const User = require('../src/models/User');
const Service = require('../src/models/Service');
const Appointment = require('../src/models/Appointment');

const noName = [
    { $or: [{ guestName: null }, { guestName: '' }] },
    { $or: [{ walkInName: null }, { walkInName: '' }] },
];

async function findOrphans() {
    // 1) Services whose business account is gone.
    const withProvider = await Service.aggregate([
        { $match: { provider: { $ne: null } } },
        { $group: { _id: '$provider', services: { $sum: 1 }, active: { $sum: { $cond: ['$isActive', 1, 0] } } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'owner' } },
        { $match: { owner: { $size: 0 } } },
        { $project: { _id: 1, services: 1, active: 1 } },
        { $sort: { active: -1, _id: 1 } },
    ]);
    const orphanServices = withProvider.map((r) => ({ business: String(r._id), services: r.services, active: r.active }));

    // 2) provider:null services an admin didn't create (unexpected "globals").
    const adminIds = (await User.find({ role: 'admin' }).select('_id').lean()).map((u) => u._id);
    const oddGlobals = await Service.countDocuments({ provider: null, createdBy: { $nin: adminIds } });

    // 3) Bookings with no client name at all.
    const nullCustomerNoName = await Appointment.countDocuments({ customer: null, $and: noName });
    const [dangling] = await Appointment.aggregate([
        { $match: { customer: { $ne: null }, $and: noName } },
        { $lookup: { from: 'users', localField: 'customer', foreignField: '_id', as: 'c' } },
        { $match: { c: { $size: 0 } } },
        { $count: 'n' },
    ]);
    return {
        orphanServices,
        oddGlobals,
        nullCustomerNoName,
        missingCustomerNoName: dangling?.n || 0,
    };
}

/** The deploy-log lines: ids and counts, nothing else. */
function report(r) {
    const lines = [];
    const active = r.orphanServices.reduce((n, x) => n + x.active, 0);
    const all = r.orphanServices.reduce((n, x) => n + x.services, 0);
    if (!r.orphanServices.length) {
        lines.push('report_orphans: no services belong to a deleted business.');
    } else {
        lines.push(`report_orphans: ${all} service(s) (${active} still marked active) belong to ${r.orphanServices.length} deleted business(es). They are hidden from clients and can't be booked:`);
        r.orphanServices.forEach((x) => lines.push(`  business ${x.business}: ${x.services} service(s), ${x.active} active`));
    }
    lines.push(r.oddGlobals
        ? `report_orphans: ${r.oddGlobals} global service(s) (no business) were not created by a current admin — check them in Admin → Services.`
        : 'report_orphans: every global service was created by an admin.');
    const nameless = r.nullCustomerNoName + r.missingCustomerNoName;
    lines.push(nameless
        ? `report_orphans: ${nameless} booking(s) have no client name (${r.nullCustomerNoName} with no client, ${r.missingCustomerNoName} whose client account was deleted). The admin console shows them as "Deleted account".`
        : 'report_orphans: every booking has a client or a client name.');
    return lines;
}

module.exports = { findOrphans, report };

// CLI entry point (skipped when required by tests). Always exits 0.
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.log('report_orphans: MONGODB_URI is not set — skipped.'); return; }
        await mongoose.connect(uri);
        report(await findOrphans()).forEach((l) => console.log(l));
        await mongoose.disconnect();
    })()
        .catch((err) => console.log(`report_orphans: could not run (${err.message}) — nothing was changed.`))
        .finally(() => process.exit(0));
}
