/**
 * Availability-first provider search — "who can actually take me on <date>
 * (around <time>)?". For each candidate provider the day is computed as:
 * business hours ∩ (union of staff columns, or the owner column when there is
 * no roster) − blocked time (business-wide + per-staff) − existing bookings.
 * Buffers are intentionally ignored here: search promises an OPENING; the
 * booking flow re-validates the exact slot (incl. buffers + races) on create.
 */
const User = require('../models/User');
const Service = require('../models/Service');
const Availability = require('../models/Availability');
const StaffAvailability = require('../models/StaffAvailability');
const BlockedTime = require('../models/BlockedTime');
const TeamMember = require('../models/TeamMember');
const Appointment = require('../models/Appointment');

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const GRID_STEP = 30; // minutes between offered start times
// Mirrors the booking page's fallback for providers who never published hours.
const DEFAULT_BLOCKS = [{ start: 8 * 60, end: 20 * 60 }];

const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
};
const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const overlaps = (aS, aE, bS, bE) => aS < bE && aE > bS;

const blocksFor = (schedule, dateStr) => {
    if (!schedule) return DEFAULT_BLOCKS;
    const [y, m, d] = dateStr.split('-').map(Number);
    const day = schedule[DAY_NAMES[new Date(y, m - 1, d).getDay()]];
    if (!day?.enabled || !Array.isArray(day.slots) || day.slots.length === 0) return [];
    return day.slots
        .filter(s => s?.start && s?.end)
        .map(s => ({ start: toMin(s.start), end: toMin(s.end) }))
        .filter(b => b.end > b.start);
};

/**
 * @param {{date: string, time?: string, q?: string, duration?: number, maxOpenings?: number}} params
 * @returns {Promise<Array<{provider: string, openings: string[], openingsCount: number}>>}
 */
async function searchAvailability({ date, time, q, duration = 30, maxOpenings = 4 }) {
    // 1) Candidate providers: anyone with an active service; a text query
    //    narrows by service name/category OR business/provider name.
    const services = await Service.find({ isActive: true, provider: { $ne: null } })
        .select('provider name category');
    const byProvider = new Map();
    services.forEach(s => {
        const pid = s.provider.toString();
        if (!byProvider.has(pid)) byProvider.set(pid, []);
        byProvider.get(pid).push(s);
    });

    let candidateIds = [...byProvider.keys()];
    if (q && q.trim()) {
        const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const matchingProviders = await User.find({
            _id: { $in: candidateIds }, role: 'provider',
            $or: [{ name: rx }, { 'businessProfile.businessName': rx }, { providerCategory: rx }],
        }).select('_id');
        const byName = new Set(matchingProviders.map(u => u._id.toString()));
        candidateIds = candidateIds.filter(pid =>
            byName.has(pid) || byProvider.get(pid).some(s => rx.test(s.name)));
    }
    if (candidateIds.length === 0) return [];

    // 2) Batch-load everything for the day (5 queries total, any provider count).
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    const [availabilities, members, blocked, appts] = await Promise.all([
        Availability.find({ provider: { $in: candidateIds } }).select('provider schedule'),
        TeamMember.find({ provider: { $in: candidateIds }, isActive: true }).select('provider'),
        BlockedTime.find({ provider: { $in: candidateIds }, date }).select('provider teamMember startTime endTime'),
        Appointment.find({
            provider: { $in: candidateIds },
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            status: { $nin: ['cancelled'] },
        }).select('provider teamMember startTime endTime'),
    ]);
    const staffAvail = await StaffAvailability.find({ teamMember: { $in: members.map(m => m._id) } })
        .select('teamMember schedule');

    const availByProvider = new Map(availabilities.map(a => [a.provider.toString(), a.schedule]));
    const staffAvailByMember = new Map(staffAvail.map(a => [a.teamMember.toString(), a.schedule]));
    const membersByProvider = new Map();
    members.forEach(m => {
        const pid = m.provider.toString();
        if (!membersByProvider.has(pid)) membersByProvider.set(pid, []);
        membersByProvider.get(pid).push(m._id.toString());
    });

    // 3) Time filters: an explicit ?time= floor, and never-in-the-past for today.
    let minStart = time ? toMin(time) : 0;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (date === todayStr) minStart = Math.max(minStart, now.getHours() * 60 + now.getMinutes());

    const results = [];
    for (const pid of candidateIds) {
        const businessSchedule = availByProvider.get(pid) || null;
        const businessBlocks = blocksFor(businessSchedule, date);
        if (businessBlocks.length === 0) continue; // closed that day

        const roster = membersByProvider.get(pid) || [];
        // Columns: each staff member, or the owner when there's no roster.
        const columns = (roster.length ? roster : [null]).map(memberId => {
            const ownSchedule = memberId ? staffAvailByMember.get(memberId) : null;
            const busy = [];
            appts.forEach(a => {
                if (a.provider.toString() !== pid) return;
                const col = a.teamMember ? a.teamMember.toString() : null;
                if (col === memberId) busy.push({ start: toMin(a.startTime), end: toMin(a.endTime) });
            });
            blocked.forEach(b => {
                if (b.provider.toString() !== pid) return;
                const scope = b.teamMember ? b.teamMember.toString() : null;
                if (scope === null || scope === memberId) busy.push({ start: toMin(b.startTime), end: toMin(b.endTime) });
            });
            return {
                blocks: ownSchedule ? blocksFor(ownSchedule, date) : businessBlocks,
                busy,
            };
        });

        const openings = [];
        for (const block of businessBlocks) {
            let t = Math.max(block.start, Math.ceil(minStart / GRID_STEP) * GRID_STEP);
            t = Math.ceil(t / GRID_STEP) * GRID_STEP;
            for (; t + duration <= block.end; t += GRID_STEP) {
                const open = columns.some(col =>
                    col.blocks.some(b => t >= b.start && t + duration <= b.end)
                    && !col.busy.some(r => overlaps(t, t + duration, r.start, r.end)));
                if (open) {
                    openings.push(fmt(t));
                    if (openings.length >= maxOpenings) break;
                }
            }
            if (openings.length >= maxOpenings) break;
        }
        if (openings.length > 0) {
            results.push({ provider: pid, openings, openingsCount: openings.length });
        }
    }

    // Earliest opening first — "who can take me soonest".
    results.sort((a, b) => toMin(a.openings[0]) - toMin(b.openings[0]));
    return results;
}

module.exports = { searchAvailability };
