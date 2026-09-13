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
const Shift = require('../models/Shift');
const TimeOff = require('../models/TimeOff');
const { NAMIBIA_OFFSET_MIN } = require('./appointmentTime');
const { pickRotationWeek } = require('./staffBooking');

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
        BlockedTime.find({ provider: { $in: candidateIds }, date }).select('provider teamMember ownerOnly startTime endTime'),
        Appointment.find({
            provider: { $in: candidateIds },
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            status: { $nin: ['cancelled'] },
        }).select('provider teamMember startTime endTime'),
    ]);
    const memberIds = members.map(m => m._id);
    // Roster shape for THIS date, mirroring the booking validator's precedence
    // (staffHoursReason): approved leave overrides the roster, and a date-specific
    // Shift REPLACES the weekly pattern. Without these the search surfaced openings
    // the booking flow then rejects (a member on leave, or rostered off that day).
    const [staffAvail, shifts, leaves] = await Promise.all([
        StaffAvailability.find({ teamMember: { $in: memberIds } }).select('teamMember schedule rotation'),
        Shift.find({ teamMember: { $in: memberIds }, date }).select('teamMember slots breaks'),
        TimeOff.find({
            teamMember: { $in: memberIds }, status: 'approved',
            startDate: { $lte: date }, endDate: { $gte: date },
        }).select('teamMember allDay startTime endTime'),
    ]);

    const availByProvider = new Map(availabilities.map(a => [a.provider.toString(), a.schedule]));
    // Store the whole doc (schedule + rotation) so the rotation week can be
    // selected per date, mirroring the booking validator (staffBooking).
    const staffAvailByMember = new Map(staffAvail.map(a => [a.teamMember.toString(), a]));
    const shiftByMember = new Map(shifts.map(s => [s.teamMember.toString(), s]));
    const leavesByMember = new Map();
    leaves.forEach((lv) => {
        const k = lv.teamMember.toString();
        if (!leavesByMember.has(k)) leavesByMember.set(k, []);
        leavesByMember.get(k).push(lv);
    });
    const membersByProvider = new Map();
    members.forEach(m => {
        const pid = m.provider.toString();
        if (!membersByProvider.has(pid)) membersByProvider.set(pid, []);
        membersByProvider.get(pid).push(m._id.toString());
    });

    // 3) Time filters: an explicit ?time= floor, and never-in-the-past for today.
    // "Today" and the past-slot floor are Namibia local (Africa/Windhoek, UTC+2),
    // NOT the server's UTC — slot times are Namibia wall-clock minutes, so a
    // UTC floor was 2h off and the 00:00–02:00 local window read as the previous
    // day. Shift into local the same way realStartMs does everywhere else.
    let minStart = time ? toMin(time) : 0;
    const nib = new Date(Date.now() + NAMIBIA_OFFSET_MIN * 60000);
    const todayStr = `${nib.getUTCFullYear()}-${String(nib.getUTCMonth() + 1).padStart(2, '0')}-${String(nib.getUTCDate()).padStart(2, '0')}`;
    if (date === todayStr) minStart = Math.max(minStart, nib.getUTCHours() * 60 + nib.getUTCMinutes());

    const results = [];
    for (const pid of candidateIds) {
        const businessSchedule = availByProvider.get(pid) || null;
        const businessBlocks = blocksFor(businessSchedule, date);
        if (businessBlocks.length === 0) continue; // closed that day

        const roster = membersByProvider.get(pid) || [];
        // Columns: each staff member, or the owner when there's no roster.
        const columns = (roster.length ? roster : [null]).map(memberId => {
            const busy = [];
            appts.forEach(a => {
                if (a.provider.toString() !== pid) return;
                const col = a.teamMember ? a.teamMember.toString() : null;
                if (col === memberId) busy.push({ start: toMin(a.startTime), end: toMin(a.endTime) });
            });
            blocked.forEach(b => {
                if (b.provider.toString() !== pid) return;
                const scope = b.teamMember ? b.teamMember.toString() : null;
                // Owner-only blocks (null scope + ownerOnly) apply only to the owner
                // column (memberId === null); business-wide blocks apply to all.
                const applies = scope === memberId
                    || (scope === null && !b.ownerOnly)
                    || (scope === null && b.ownerOnly && memberId === null);
                if (applies) busy.push({ start: toMin(b.startTime), end: toMin(b.endTime) });
            });

            // Working windows, honouring the booking validator's precedence for a
            // real member: approved leave → a date-specific Shift (which REPLACES
            // the weekly pattern, its breaks becoming busy) → weekly pattern →
            // business hours. The owner column (no roster) has no Shift/TimeOff.
            let blocks;
            if (memberId) {
                const memberLeaves = leavesByMember.get(memberId) || [];
                // An all-day (or window-less) approved leave closes the whole day.
                const offAllDay = memberLeaves.some(lv => lv.allDay || lv.startTime == null || lv.endTime == null);
                if (offAllDay) {
                    blocks = [];
                } else {
                    // Windowed leave → busy interval(s).
                    memberLeaves.forEach(lv => busy.push({ start: toMin(lv.startTime), end: toMin(lv.endTime) }));
                    const shift = shiftByMember.get(memberId);
                    if (shift) {
                        blocks = (shift.slots || [])
                            .map(sl => ({ start: toMin(sl.start), end: toMin(sl.end) }))
                            .filter(b => b.end > b.start);
                        (shift.breaks || []).forEach(b => busy.push({ start: toMin(b.start), end: toMin(b.end) }));
                    } else {
                        const ownDoc = staffAvailByMember.get(memberId);
                        // Rotation-aware: the week that applies on THIS date (or the
                        // flat schedule when the member has no rotation).
                        const ownSchedule = ownDoc ? pickRotationWeek(ownDoc, date) : null;
                        blocks = ownSchedule ? blocksFor(ownSchedule, date) : businessBlocks;
                    }
                }
            } else {
                blocks = businessBlocks;
            }
            return { blocks, busy };
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
