/**
 * Deploy report — READ-ONLY, and it NEVER fails the deploy: every outcome exits 0.
 *
 * Who stops being bookable. Team members used to fall back to the business's
 * opening hours when they had none of their own; now a member with no working
 * hours of their own (no weekly hours) can't be booked
 * at all. This prints, per business, how many active, bookable team members are
 * in that state — and how many upcoming bookings and waiting-list places they
 * hold (those bookings stand; clients just can't move them to a new time until
 * hours are set) — so the owner can be told to set their hours.
 *
 * Every member works only their own hours (staffBooking.weeklyHoursFor) —
 * a business's only bookable member included — so anyone without hours of
 * their own is in this report.
 *
 * Counts only: a business id and numbers. Never a name, email or phone — the
 * deploy log is not the place for people's details. It writes nothing.
 *
 * "Has hours" is the same rule the Team card and the client's tiles use
 * (staffBooking.membersHoursReadiness): weekly hours with at least one working
 * period on some day (any week of a rotation). Old Shift rows don't count.
 *
 * Run it BEFORE the deploy too (read-only, against production) so affected
 * owners can be told ahead of time:
 *
 * Run locally:   node scripts/report_members_without_hours.js
 * In Docker:     docker compose exec -T server node scripts/report_members_without_hours.js
 */
const TeamMember = require('../src/models/TeamMember');
const Appointment = require('../src/models/Appointment');
const WaitingList = require('../src/models/WaitingList');
const { membersHoursReadiness } = require('../src/utils/staffBooking');

/**
 * [{ business, withoutHours, bookable, upcomingBookings, waiting }] for every
 * business with at least one member without hours. `upcomingBookings` are
 * pending/confirmed bookings from today on that one of those members performs
 * (top-level or a segment); `waiting` are waiting-list places for one of them.
 */
async function membersWithoutHours({ today } = {}) {
    const members = await TeamMember.find({ isActive: true, bookable: { $ne: false } })
        .select('_id provider').lean();
    const readiness = await membersHoursReadiness(members.map((m) => m._id));
    const byBusiness = new Map();
    const noHoursIds = [];
    members.forEach((m) => {
        const k = String(m.provider);
        const row = byBusiness.get(k) || { business: k, withoutHours: 0, bookable: 0, upcomingBookings: 0, waiting: 0 };
        row.bookable += 1;
        if (!readiness.get(String(m._id))) { row.withoutHours += 1; noHoursIds.push(m._id); }
        byBusiness.set(k, row);
    });
    if (noHoursIds.length) {
        const todayKey = today || new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10); // Windhoek
        const from = new Date(`${todayKey}T00:00:00.000Z`);
        const [bookings, waiting] = await Promise.all([
            Appointment.aggregate([
                { $match: {
                    status: { $in: ['pending', 'confirmed'] },
                    appointmentDate: { $gte: from },
                    $or: [{ teamMember: { $in: noHoursIds } }, { 'services.teamMember': { $in: noHoursIds } }],
                } },
                { $group: { _id: '$provider', n: { $sum: 1 } } },
            ]),
            WaitingList.aggregate([
                { $match: { status: 'waiting', teamMember: { $in: noHoursIds } } },
                { $group: { _id: '$provider', n: { $sum: 1 } } },
            ]),
        ]);
        bookings.forEach((b) => { const row = byBusiness.get(String(b._id)); if (row) row.upcomingBookings = b.n; });
        waiting.forEach((w) => { const row = byBusiness.get(String(w._id)); if (row) row.waiting = w.n; });
    }
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
        ...rows.map((r) => `  business ${r.business}: ${r.withoutHours} of ${r.bookable} bookable member(s) without hours`
            + ` · ${r.upcomingBookings || 0} upcoming booking(s) and ${r.waiting || 0} waiting-list place(s) with them`),
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
