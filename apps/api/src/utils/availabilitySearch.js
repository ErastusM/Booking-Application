/**
 * Availability-first provider search — "who can actually take me on <date>
 * (around <time>)?". For each candidate provider the day is computed as:
 * the union of the bookable staff columns — each over their OWN hours only
 * (never capped by the business's; none of their own = closed) — plus the owner
 * column over the business (owner's) hours when the owner offers anything; each
 * column minus its own blocked time (the owner's blocks close only the owner's
 * column) and its own existing bookings.
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
const { pickRotationWeek, memberBusyIntervalsBuffered, ownerPerforms, availabilityHasHours } = require('./staffBooking');
const { bookableMembersByProvider, hasPerformer } = require('./serviceOffering');

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const GRID_STEP = 30; // minutes between offered start times (plus each period's own opening time)
// Mirrors the booking page's fallback for providers who never published hours.
const DEFAULT_BLOCKS = [{ start: 8 * 60, end: 20 * 60 }];

const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
};
const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const overlaps = (aS, aE, bS, bE) => aS < bE && aE > bS;

// Periods that touch or overlap read as one, as the booking validator reads them
// (staffBooking.withinPeriods).
const mergeBlocks = (blocks) => blocks
    .filter(b => b.end > b.start)
    .sort((a, b) => a.start - b.start)
    .reduce((out, b) => {
        const last = out[out.length - 1];
        if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
        else out.push({ ...b });
        return out;
    }, []);

const blocksFor = (schedule, dateStr) => {
    if (!schedule) return DEFAULT_BLOCKS;
    const [y, m, d] = dateStr.split('-').map(Number);
    const day = schedule[DAY_NAMES[new Date(y, m - 1, d).getDay()]];
    if (!day?.enabled || !Array.isArray(day.slots) || day.slots.length === 0) return [];
    return mergeBlocks(day.slots
        .filter(s => s?.start && s?.end)
        .map(s => ({ start: toMin(s.start), end: toMin(s.end) })));
};

/**
 * @param {{date: string, time?: string, q?: string, duration?: number, maxOpenings?: number}} params
 * @returns {Promise<Array<{provider: string, openings: string[], openingsCount: number}>>}
 */
async function searchAvailability({ date, time, q, duration = 30, maxOpenings = 4 }) {
    // 1) Candidate providers: anyone with an active service; a text query
    //    narrows by service name/category OR business/provider name.
    //    Only services someone can actually be booked for count: a service
    //    only a departed member performed would otherwise still match a query
    //    and surface a business that can't take the booking.
    const allServices = await Service.find({ isActive: true, provider: { $ne: null } })
        .select('provider name category ownerPerforms');
    const membersBy = await bookableMembersByProvider([...new Set(allServices.map(s => s.provider.toString()))]);
    const services = allServices.filter(s => hasPerformer(s, membersBy.get(s.provider.toString()) || []));
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
        // Only people clients can be sent to: a front-desk member (bookable:false)
        // with hours would otherwise advertise openings nobody can take.
        TeamMember.find({ provider: { $in: candidateIds }, isActive: true, bookable: { $ne: false } }).select('provider'),
        BlockedTime.find({ provider: { $in: candidateIds }, date }).select('provider teamMember ownerOnly startTime endTime'),
        Appointment.find({
            provider: { $in: candidateIds },
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            status: { $nin: ['cancelled'] },
        }).select('provider teamMember startTime endTime services'),
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
        // The business's (owner's) hours: the owner's own column only. A member
        // can work a day the owner is closed, so a closed business day no
        // longer hides the business when a member works it.
        const businessBlocks = blocksFor(businessSchedule, date);

        const roster = membersByProvider.get(pid) || [];
        // Columns: each bookable staff member, plus the owner's own column when
        // the owner offers any of these services (always, with no roster). The
        // owner is a bookable professional next to the team (getProviderStaff),
        // so a business whose members have no hours of their own still shows the
        // owner's openings instead of vanishing from search.
        const ownerColumn = !roster.length || (byProvider.get(pid) || []).some(ownerPerforms);
        const columns = [...roster, ...(ownerColumn ? [null] : [])].map(memberId => {
            const busy = [];
            appts.forEach(a => {
                if (a.provider.toString() !== pid) return;
                // This column's OWN windows: a member's segments of a multi-service
                // ticket (or their single booking); for the owner column the
                // unassigned ones. The top-level performer + whole span missed a
                // colleague's segment and offered an opening the booking refuses.
                // (Unbuffered: search promises an opening, see above.)
                memberBusyIntervalsBuffered(a, memberId, {}).forEach(([s, e]) => busy.push({ start: s, end: e }));
            });
            blocked.forEach(b => {
                if (b.provider.toString() !== pid) return;
                const scope = b.teamMember ? b.teamMember.toString() : null;
                // A block closes only its own column: a member's block that
                // member's, and every null-scoped block the owner's alone (legacy
                // "business-wide" rows included — they never close a member).
                if (scope === memberId) busy.push({ start: toMin(b.startTime), end: toMin(b.endTime) });
            });

            // Working windows, honouring the booking validator's precedence for a
            // real member: approved leave → a date-specific Shift (which REPLACES
            // the weekly pattern, its breaks becoming busy) → their own weekly
            // pattern → nothing (no hours of their own = not bookable). The owner
            // column works the business hours and has no Shift/TimeOff.
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
                        blocks = mergeBlocks((shift.slots || [])
                            .map(sl => ({ start: toMin(sl.start), end: toMin(sl.end) })));
                        (shift.breaks || []).forEach(b => busy.push({ start: toMin(b.start), end: toMin(b.end) }));
                    } else {
                        const ownDoc = staffAvailByMember.get(memberId);
                        if (!availabilityHasHours(ownDoc)) {
                            blocks = [];                    // no hours of their own: not bookable
                        } else {
                            // Rotation-aware: the week that applies on THIS date (or
                            // the flat schedule when the member has no rotation).
                            blocks = blocksFor(pickRotationWeek(ownDoc, date), date);
                        }
                    }
                }
            } else {
                blocks = businessBlocks;
            }
            return { blocks, busy };
        });

        // Search every window SOMEONE works: the union of the columns' hours.
        const dayWindows = mergeBlocks(columns.flatMap(col => col.blocks.map(b => ({ ...b }))));
        if (dayWindows.length === 0) continue; // nobody works that day

        const openings = [];
        for (const block of dayWindows) {
            // Candidate starts: the grid, plus every working period's exact opening
            // time inside this block — each column's, the owner's (08:30) and each
            // member's (a member starting 08:15, or 14:30 after a split day's
            // break). The owner's answer: an opening time is always offered when
            // the service fits, even off the grid.
            const fits = (t) => t >= block.start && t >= minStart && t + duration <= block.end;
            const candidates = new Set();
            let t = Math.max(block.start, Math.ceil(minStart / GRID_STEP) * GRID_STEP);
            t = Math.ceil(t / GRID_STEP) * GRID_STEP;
            for (; t + duration <= block.end; t += GRID_STEP) candidates.add(t);
            [block.start, ...columns.flatMap(col => col.blocks.map(b => b.start))]
                .filter(fits)
                .forEach(s => candidates.add(s));
            for (const start of [...candidates].sort((a, b) => a - b)) {
                const open = columns.some(col =>
                    col.blocks.some(b => start >= b.start && start + duration <= b.end)
                    && !col.busy.some(r => overlaps(start, start + duration, r.start, r.end)));
                if (open) {
                    openings.push(fmt(start));
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
