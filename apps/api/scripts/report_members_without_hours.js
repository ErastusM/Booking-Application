/**
 * Deploy report — READ-ONLY, and it NEVER fails the deploy: every outcome exits 0.
 *
 * Who stops being bookable. Team members used to fall back to the business's
 * opening hours when they had none of their own; now a member with no working
 * hours of their own (no weekly hours, no shift today or later) can't be booked
 * at all. This prints, per business, how many active, bookable team members are
 * in that state, so the owner can be told to set their hours.
 *
 * Counts only: a business id and numbers. Never a name, email or phone — the
 * deploy log is not the place for people's details. It writes nothing.
 *
 * "Has hours" is the same rule the Team card and the client's tiles use
 * (staffBooking.membersHoursReadiness): weekly hours with at least one working
 * period on some day (any week of a rotation), or a shift with a working period
 * from today (Windhoek) on.
 *
 * Run locally:   node scripts/report_members_without_hours.js
 * In Docker:     docker compose exec -T server node scripts/report_members_without_hours.js
 */
const TeamMember = require('../src/models/TeamMember');
const { membersHoursReadiness } = require('../src/utils/staffBooking');

/** [{ business, withoutHours, bookable }] for every business with at least one member without hours. */
async function membersWithoutHours({ today } = {}) {
    const members = await TeamMember.find({ isActive: true, bookable: { $ne: false } })
        .select('_id provider').lean();
    const readiness = await membersHoursReadiness(members.map((m) => m._id), { today });
    const byBusiness = new Map();
    members.forEach((m) => {
        const k = String(m.provider);
        const row = byBusiness.get(k) || { business: k, withoutHours: 0, bookable: 0 };
        row.bookable += 1;
        if (!readiness.get(String(m._id))) row.withoutHours += 1;
        byBusiness.set(k, row);
    });
    return [...byBusiness.values()]
        .filter((r) => r.withoutHours > 0)
        .sort((a, b) => b.withoutHours - a.withoutHours || a.business.localeCompare(b.business));
}

/** The deploy-log lines: business ids and counts, nothing else. */
function report(rows) {
    if (!rows.length) return ['report_members_without_hours: every active, bookable team member has working hours of their own.'];
    const total = rows.reduce((n, r) => n + r.withoutHours, 0);
    return [
        `report_members_without_hours: ${total} active, bookable team member(s) in ${rows.length} business(es) have no working hours of their own, so clients can't book them until hours are set:`,
        ...rows.map((r) => `  business ${r.business}: ${r.withoutHours} of ${r.bookable} bookable member(s) without hours`),
    ];
}

module.exports = { membersWithoutHours, report };

// CLI entry point (skipped when required by tests). Always exits 0: this only
// reports, and a report must never block a deploy.
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.log('report_members_without_hours: MONGODB_URI is not set — skipped.'); return; }
        await mongoose.connect(uri);
        report(await membersWithoutHours()).forEach((l) => console.log(l));
        await mongoose.disconnect();
    })()
        .catch((err) => console.log(`report_members_without_hours: could not run (${err.message}) — nothing was changed.`))
        .finally(() => process.exit(0));
}
