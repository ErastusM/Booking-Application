/**
 * Read-only deploy report — changes NOTHING, and NEVER fails the deploy: every
 * outcome exits 0.
 *
 * Are there double bookings already on the books?
 *
 * The booking rule is that a person is only ever booked for one thing at a time:
 * a booking's whole window must not overlap another booking of the SAME person
 * (touching is fine — one ending at 15:00 and the next starting at 15:00 do not
 * overlap). Some paths used to let a booking through that broke it (a slower
 * member's "any available" booking at the menu length, an owner-posted window
 * shorter than the service, a colleague's multi-service segment the business app
 * didn't see). Those paths are closed; this tells the owner whether any of the
 * bookings they let through are still ahead.
 *
 * For every business it counts the upcoming (today onwards) pending/confirmed
 * bookings that overlap another pending/confirmed booking of the same person:
 *   - a team member is busy over their own single bookings and their own
 *     segments of multi-service tickets; the owner over the unassigned ones;
 *   - the rows of one group booking share a window on purpose and never count
 *     against each other.
 *
 * Output is COUNTS PER BUSINESS ID ONLY — no names, emails, phone numbers,
 * services or times — so it is safe in a deploy log.
 *
 * Run locally:   node scripts/report_overlapping_bookings.js
 * In Docker:     docker compose exec -T server node scripts/report_overlapping_bookings.js
 */
const NAMIBIA_OFFSET_MIN = 120; // Africa/Windhoek, UTC+2, no DST (src/utils/appointmentTime)

const toMin = (t) => {
    const [h, m] = String(t || '').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};

// The windows one booking occupies, per person ('owner' = the unassigned column).
const lanesOf = (a) => {
    if (Array.isArray(a.services) && a.services.length) {
        return a.services.map((s) => ({ lane: s.teamMember ? String(s.teamMember) : 'owner', s: toMin(s.startTime), e: toMin(s.endTime) }));
    }
    return [{ lane: a.teamMember ? String(a.teamMember) : 'owner', s: toMin(a.startTime), e: toMin(a.endTime) }];
};

/**
 * Pure: given upcoming bookings, the number that overlap another booking of the
 * same person, per business id. Exported for the tests.
 */
function countOverlaps(appointments) {
    const byDay = new Map(); // provider|day → windows
    for (const a of appointments) {
        if (!a.provider || !a.appointmentDate) continue;
        const day = new Date(a.appointmentDate).toISOString().slice(0, 10);
        const key = `${a.provider}|${day}`;
        if (!byDay.has(key)) byDay.set(key, []);
        const id = String(a._id);
        const group = a.groupId || null;
        lanesOf(a).forEach((w) => {
            if (w.e > w.s) byDay.get(key).push({ ...w, id, group, provider: String(a.provider) });
        });
    }
    const flagged = new Map(); // provider → Set of booking ids
    for (const windows of byDay.values()) {
        const byLane = new Map();
        windows.forEach((w) => {
            if (!byLane.has(w.lane)) byLane.set(w.lane, []);
            byLane.get(w.lane).push(w);
        });
        for (const list of byLane.values()) {
            list.sort((x, y) => x.s - y.s);
            for (let i = 0; i < list.length; i += 1) {
                for (let j = i + 1; j < list.length && list[j].s < list[i].e; j += 1) {
                    const x = list[i]; const y = list[j];
                    if (x.id === y.id) continue;                    // one ticket's own segments
                    if (x.group && x.group === y.group) continue;   // one group booking
                    if (!flagged.has(x.provider)) flagged.set(x.provider, new Set());
                    flagged.get(x.provider).add(x.id).add(y.id);
                }
            }
        }
    }
    const out = {};
    for (const [provider, ids] of flagged) out[provider] = ids.size;
    return out;
}

async function reportOverlappingBookings({ now = new Date() } = {}) {
    const Appointment = require('../src/models/Appointment');
    // Today in Windhoek, as the UTC-midnight date bookings are stored under.
    const local = new Date(now.getTime() + NAMIBIA_OFFSET_MIN * 60 * 1000);
    const today = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
    const appointments = await Appointment.find({
        status: { $in: ['pending', 'confirmed'] },
        appointmentDate: { $gte: today },
        provider: { $ne: null },
    }).select('provider appointmentDate startTime endTime teamMember services.teamMember services.startTime services.endTime groupId').lean();
    const byBusiness = countOverlaps(appointments);
    const businesses = new Set(appointments.map((a) => String(a.provider)));
    return { checked: appointments.length, businesses: businesses.size, byBusiness };
}

/** The deploy-log lines: counts per business id, nothing else. */
function report(r) {
    const entries = Object.entries(r.byBusiness).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, n]) => s + n, 0);
    const lines = [`report_overlapping_bookings: checked ${r.checked} upcoming pending/confirmed booking(s) across ${r.businesses} business(es).`];
    if (!total) {
        lines.push('report_overlapping_bookings: no upcoming booking overlaps another booking of the same person.');
    } else {
        lines.push(`report_overlapping_bookings: ${total} upcoming booking(s) overlap another booking of the same person, in ${entries.length} business(es):`);
        entries.forEach(([id, n]) => lines.push(`  business ${id}: ${n}`));
    }
    return lines;
}

module.exports = { countOverlaps, reportOverlappingBookings, report };

// CLI entry point (skipped when required by tests). Read-only and always exits 0:
// a report must never block a deploy.
if (require.main === module) {
    require('dotenv').config();
    const mongoose = require('mongoose');
    (async () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.log('report_overlapping_bookings: MONGODB_URI is not set — skipped.'); return; }
        await mongoose.connect(uri);
        const r = await reportOverlappingBookings();
        report(r).forEach((l) => console.log(l));
        await mongoose.disconnect();
    })()
        // The error NAME only: a driver message can quote the connection string.
        .catch((err) => console.log(`report_overlapping_bookings: could not run (${(err && err.name) || 'error'}) — nothing was changed.`))
        .finally(() => process.exit(0));
}
