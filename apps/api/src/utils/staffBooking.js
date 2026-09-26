/**
 * Per-staff booking math (DUAL_APP_SPEC.md §3.6).
 *
 * A slot is bookable for staff S / service V / date D iff it is
 *   1. within business hours            (enforced upstream for customers, as before)
 *   2. within S's OWN hours             (their shift for D, else their weekly
 *                                        hours; nothing is inherited from the
 *                                        business — no hours of their own = not
 *                                        bookable, reason 'no_hours')
 *   3. outside business-wide AND S's own BlockedTime
 *   4. free of S's overlapping appointments, including V's buffers
 * "Any available" = the earliest-created active member who performs V and
 * passes 2–4.
 *
 * Back-compat guarantees (spec §3.7):
 *   - zero-staff businesses resolve to teamMember:null — byte-identical to the
 *     pre-staff behavior (no new checks run)
 *   - provider/admin bookings keep their override power (walk-ins outside
 *     hours); only ownership is validated
 *   - a roster where nobody performs V resolves to null = the owner performs
 *     it (owner is implicitly staff-index-0)
 */
const TeamMember = require('../models/TeamMember');
const StaffAvailability = require('../models/StaffAvailability');
const BlockedTime = require('../models/BlockedTime');
const Shift = require('../models/Shift');
const TimeOff = require('../models/TimeOff');
const Appointment = require('../models/Appointment');
const Availability = require('../models/Availability');
const Service = require('../models/Service');

const { effectiveDuration } = require('./memberPricing');

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
};
const overlaps = (aS, aE, bS, bE) => aS < bE && aE > bS;
const dateStr = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * THE booking rule, in one place. A person can take [startMin, endMin) iff the
 * whole window lies inside one of their working periods and overlaps none of
 * their busy windows (bookings, blocked time, breaks, leave). Half-open: a
 * booking that ends exactly when the next one starts does NOT overlap it.
 *
 * `working` null = no hours constraint. Every overlap test in the booking paths
 * (create, reschedule, recurring, group, multi-service, waiting list, the slot
 * views) is this predicate over that person's own windows.
 */
const overlapsAny = (startMin, endMin, intervals) => (intervals || []).some(([s, e]) => overlaps(startMin, endMin, s, e));
const windowFits = ({ startMin, endMin, working = null, busy = [] }) => endMin > startMin
    && (working == null || working.some(([a, b]) => startMin >= a && endMin <= b))
    && !overlapsAny(startMin, endMin, busy);

/**
 * How many minutes one professional needs for a booking: the chosen option's
 * own length (options carry their own), else that person's duration override
 * for the service (TeamMember.serviceOverrides — #228), else the menu duration;
 * plus the add-on minutes. `member` null = the owner, who books at the menu
 * length. This is the length every overlap check must use for that person — a
 * 2-hour job checked as 1 hour lands on top of their next booking.
 */
const performerMinutes = ({ svc, member = null, option = null, addOnMinutes = 0 }) => {
    const base = option && option.duration > 0 ? option.duration : effectiveDuration(member, svc);
    return (base > 0 ? base : 30) + (addOnMinutes || 0);
};

/**
 * The [startMin, endMin] windows an appointment occupies FOR one member.
 *
 * A multi-service booking splits across staff — each services[] entry has its
 * own teamMember and its own start/end — so only that member's OWN segments
 * count against them. Blocking a colleague for the whole ticket's span (or, the
 * bug this fixes, failing to block a segment performer at all because they're
 * not the top-level teamMember) both come from ignoring the segment breakdown.
 * A single-service booking (no services[]) counts wholly for its one member.
 */
const memberBusyIntervals = (appt, memberId) => {
    const id = String(memberId);
    if (Array.isArray(appt.services) && appt.services.length) {
        const out = appt.services
            .filter(s => String(s.teamMember) === id)
            .map(s => [toMin(s.startTime), toMin(s.endTime)]);
        if (String(appt.teamMember) === id) ticketRemainder(appt).forEach(iv => out.push(iv));
        return out;
    }
    return String(appt.teamMember) === id ? [[toMin(appt.startTime), toMin(appt.endTime)]] : [];
};

/**
 * The part of a multi-service ticket's span that no segment covers. A resize on
 * the calendar moves the ticket's end, not a segment's, so a ticket stretched
 * from 12:00 to 13:30 has 12:00–13:30 that belongs to no segment — and was
 * nobody's busy time: the next booking could land on it. It is the top-level
 * performer's (the lane the ticket is drawn in, and the person the stretch was
 * checked against). Empty for every ticket built by the booking paths, whose
 * segments cover the span exactly.
 */
const ticketRemainder = (appt) => subtractIntervals(
    [[toMin(appt.startTime), toMin(appt.endTime)]],
    appt.services.map(s => [toMin(s.startTime), toMin(s.endTime)]),
);
// A member is involved in a booking as its top-level performer OR a segment one.
const memberInvolvedFilter = (memberId) => ({ $or: [{ teamMember: memberId }, { 'services.teamMember': memberId }] });
// The owner's own work is stored unassigned (teamMember null) — on a single
// booking, or on the segments of a multi-service ticket they perform, even when
// a colleague is the ticket's top-level performer. Matching only `teamMember:
// null` missed those segments, so the owner could be double-booked over them.
const ownerInvolvedFilter = () => ({ $or: [{ teamMember: null }, { services: { $elemMatch: { teamMember: null } } }] });
// One lane: a member id, or null for the owner's own column.
const laneInvolvedFilter = (memberId) => (memberId ? memberInvolvedFilter(memberId) : ownerInvolvedFilter());

/**
 * The busy windows an existing appointment occupies FOR one member, each WIDENED
 * by its own service's setup/cleanup buffers.
 *
 * Overlap checks expand the INCOMING booking by its buffers, but if the existing
 * appointment's buffers are ignored, `bufferAfter` becomes order-dependent and a
 * no-op: booking A (bufferAfter 15, 10:00–10:30) then B (bufferBefore 0, 10:30–…)
 * lands flush because A's raw [600,630] doesn't reach B — yet booked the other
 * way round it WOULD clash. Widening both sides makes the reservation symmetric,
 * so an existing booking's cleanup time reliably blocks the next slot regardless
 * of the order the two were booked.
 *
 * `memberId` null = the owner's own column: an unassigned single booking, or the
 * unassigned segments of a multi-service ticket. (It used to be the whole span of
 * whatever it was handed, which greyed the owner for a colleague's segment of a
 * ticket they started, and — given a provider-wide list — for every member's
 * bookings.) `bufferByService` maps serviceId → { bufferBefore, bufferAfter }
 * (see bufferMapForAppointments).
 */
const memberBusyIntervalsBuffered = (appt, memberId, bufferByService = {}) => {
    const widen = (s, e, svcId) => {
        const b = bufferByService[String(svcId)] || {};
        return [s - (b.bufferBefore || 0), e + (b.bufferAfter || 0)];
    };
    // Whose is a window: the owner's are the unassigned ones.
    const id = memberId == null ? null : String(memberId);
    const mine = (tm) => (id == null ? !tm : String(tm) === id);
    if (Array.isArray(appt.services) && appt.services.length) {
        const out = appt.services
            .filter(s => mine(s.teamMember))
            .map(s => widen(toMin(s.startTime), toMin(s.endTime), s.service));
        // A stretched ticket's uncovered tail is its top-level performer's.
        if (mine(appt.teamMember)) ticketRemainder(appt).forEach(([s, e]) => out.push(widen(s, e, appt.service)));
        return out;
    }
    return mine(appt.teamMember) ? [widen(toMin(appt.startTime), toMin(appt.endTime), appt.service)] : [];
};

// The whole ticket span (buffered), whoever performs it — for the provider-wide
// view, which isn't about one person.
const wholeSpanBuffered = (appt, bufferByService = {}) => {
    const b = bufferByService[String(appt.service)] || {};
    return [[toMin(appt.startTime) - (b.bufferBefore || 0), toMin(appt.endTime) + (b.bufferAfter || 0)]];
};

/**
 * Fetch the buffer settings for every service referenced by these appointments
 * — top-level and per-segment — in ONE query, as a { serviceId: {bufferBefore,
 * bufferAfter} } map for memberBusyIntervalsBuffered. Returns {} when nothing is
 * referenced (a business with no buffered services pays only this empty check).
 */
const bufferMapForAppointments = async (appts) => {
    const ids = new Set();
    for (const a of appts) {
        if (a.service) ids.add(String(a.service));
        (a.services || []).forEach(s => { if (s.service) ids.add(String(s.service)); });
    }
    if (!ids.size) return {};
    const svcs = await Service.find({ _id: { $in: [...ids] } }).select('bufferBefore bufferAfter').lean();
    const map = {};
    svcs.forEach(s => { map[String(s._id)] = { bufferBefore: s.bufferBefore || 0, bufferAfter: s.bufferAfter || 0 }; });
    return map;
};

// ── Minute-interval arithmetic (half-open [start, end)) ─────────────────────
// Used by the "any professional" slot view, which needs whole-day availability
// as ranges rather than a yes/no for one window.
const DAY_END = 24 * 60;
const mergeIntervals = (list) => {
    const sorted = list.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [s, e] of sorted) {
        const last = out[out.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else out.push([s, e]);
    }
    return out;
};
const subtractIntervals = (base, cuts) => {
    let out = mergeIntervals(base);
    for (const [cs, ce] of mergeIntervals(cuts)) {
        const next = [];
        for (const [s, e] of out) {
            if (ce <= s || cs >= e) { next.push([s, e]); continue; }
            if (cs > s) next.push([s, cs]);
            if (ce < e) next.push([ce, e]);
        }
        out = next;
    }
    return out;
};
const intersectIntervals = (a, b) => subtractIntervals(a, subtractIntervals([[0, DAY_END]], b));
const hhmmOf = (m) => {
    const clamped = Math.min(m, DAY_END - 1); // 24:00 → the '23:59' end-of-day sentinel the API already uses
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
};

// A weekly schedule's working intervals for the date. No schedule at all means
// no hours constraint — used for the BUSINESS hours, where a business that never
// published any is not held to hours (a member without hours of their own is
// handled by the callers: they are closed, never "unconstrained"); a schedule
// whose day is disabled means closed.
const scheduleDayIntervals = (schedule, date) => {
    if (!schedule) return [[0, DAY_END]];
    const day = schedule[DAY_NAMES[new Date(date).getDay()]];
    if (!day?.enabled || !Array.isArray(day.slots) || day.slots.length === 0) return [];
    return day.slots.map((s) => [toMin(s.start), toMin(s.end)]).filter(([a, b]) => b > a);
};

/**
 * The opening times of a day's working periods, as "HH:MM": each period's start,
 * after capping by the business's periods when given (null = no business hours
 * to cap by). Periods that touch or overlap read as one. Every one of these is
 * offered as a start time when the service fits before that period closes — the
 * owner's answer ("your exact opening time is always offered") — where the time
 * lists would otherwise only offer whole hours.
 */
const periodOpenings = (periods, businessPeriods = null) => {
    const own = mergeIntervals(periods || []);
    const capped = businessPeriods ? intersectIntervals(own, businessPeriods) : own;
    return capped.map(([s]) => hhmmOf(s));
};

const withinSchedule = (schedule, date, startMin, endMin) => {
    const day = schedule?.[DAY_NAMES[new Date(date).getDay()]];
    if (!day?.enabled || !Array.isArray(day.slots) || day.slots.length === 0) return false;
    return day.slots.some(s => startMin >= toMin(s.start) && endMin <= toMin(s.end));
};

const DAY_MS = 86400000;
/**
 * The effective single-week schedule object for a StaffAvailability doc on a
 * given date. If the member has a rotating (multi-week) schedule, this picks
 * weeks[weekIndex]; otherwise it returns the flat `schedule` — so a doc with no
 * rotation (every legacy row) resolves BYTE-IDENTICALLY to the pre-rotation code.
 *
 * The returned object is fed to withinSchedule/scheduleDayIntervals unchanged,
 * so the weekday is still derived exactly as before — rotation only chooses
 * WHICH week's object those helpers then index by weekday.
 *
 * Week index uses a UTC YYYY-MM-DD basis (dateStr), the SAME basis the Shift and
 * TimeOff date keys use — never getDay() — so a date can never fall into a
 * different rotation week than its own shift/leave rows at a tz boundary.
 * Never returns undefined for a doc that exists (falls back to `schedule`), so a
 * configured-but-empty week reads as CLOSED, not as "no hours constraint".
 */
const pickRotationWeek = (doc, date) => {
    if (!doc) return null;
    const rot = doc.rotation;
    const weeks = rot && Array.isArray(rot.weeks) ? rot.weeks : [];
    if (weeks.length === 0 || !rot.anchor) return doc.schedule || null;
    const a = Date.parse(`${String(rot.anchor).slice(0, 10)}T00:00:00Z`);
    const d = Date.parse(`${dateStr(date)}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(d)) return doc.schedule || null;
    const wk = Math.floor((d - a) / (7 * DAY_MS));
    const idx = ((wk % weeks.length) + weeks.length) % weeks.length; // handles dates before the anchor
    return weeks[idx] || doc.schedule || null;
};

// Does this member perform the given service?
//   offersAllServices === true  → yes, everything
//   offersAllServices === false → only the services explicitly listed (empty = none)
//   unset (legacy rows)         → empty list = all, otherwise only the listed ones
const performsService = (member, serviceId) => {
    if (member.offersAllServices === true) return true;
    const list = (member.services || []).map(String);
    if (member.offersAllServices === false) return list.includes(String(serviceId));
    return list.length === 0 || list.includes(String(serviceId));
};

// Does the OWNER perform this service? The owner's equivalent of performsService.
//
// The owner used to be assumed to perform the whole catalogue. But the catalogue
// also holds the services team members add for THEMSELVES (a driver's "Long trip"
// on a barbershop's menu), priced at the member's own price — so the owner's
// tile showed every one of them, at the member's price, and clients could book
// the owner for work only the member does. Service.ownerPerforms is now the
// owner's own list; absent (legacy rows) reads as true, which is exactly what
// every existing business did before.
const ownerPerforms = (svc) => !!svc && svc.ownerPerforms !== false;

// "Nobody offers this": no bookable member performs it and the owner doesn't
// either. Used where the old code assumed the owner as the fallback performer.
const NO_PERFORMER = {
    status: 400,
    error: 'Nobody here offers that service at the moment.',
    reason: 'no_performer',
};

const UNAVAILABLE_MESSAGES = {
    outside_hours: "That time is outside this staff member's working hours.",
    off_shift: "That staff member isn't rostered on at that time.",
    on_break: 'That staff member is on a break at that time.',
    time_off: 'That staff member is on leave then.',
    blocked: 'That staff member is not available at that time.',
    // No shift that day and no weekly hours of their own: nothing is inherited
    // from the business, so the member simply can't be booked until hours are set.
    no_hours: 'That staff member has no working hours set for that day.',
    booked: 'That staff member is already booked at that time. You can join the waiting list instead.',
};

/**
 * Is this member ROSTERED to work that window? Approved leave, else their shift
 * for the date, else their own weekly hours — see the contract on models/Shift.
 * A member with neither a shift nor weekly hours has NO hours: they are not
 * bookable ('no_hours'). The business's hours are never inherited — the owner
 * asked that a member without hours of their own can't be booked, which is also
 * what their Availability screen tells them. (The owner's own column, member
 * null, works the business hours; callers gate those.)
 *
 * Split out of isMemberFree deliberately. isMemberFree also checks existing
 * appointments, which makes it unusable for a RESCHEDULE: it would find the
 * very booking being moved and call it a conflict. The reschedule paths need
 * exactly this half, and before they had it a customer could move a booking
 * straight onto a rostered day off — shifts were enforced when a booking was
 * created and nowhere else.
 *
 * Returns null when the window is fine, or a reason string.
 */
async function staffHoursReason({ member, date, startTime, endTime }) {
    if (!member) return null;                 // owner's own column — no staff hours apply
    const startMin = toMin(startTime);
    const endMin = toMin(endTime);
    const key = dateStr(date);

    // Approved leave overrides the roster entirely: a member on leave is away even
    // if a shift or the weekly pattern says otherwise, so this is checked first.
    // Pending/declined requests never close the calendar. An all-day leave blocks
    // the whole day; a windowed one blocks only its hours.
    const leaves = await TimeOff.find({
        teamMember: member._id, status: 'approved',
        startDate: { $lte: key }, endDate: { $gte: key },
    }).select('allDay startTime endTime').lean();
    for (const lv of leaves) {
        // Missing window times mean the leave can't be interpreted as a window;
        // treat it as all-day rather than fail open (toMin(null) is NaN, and every
        // overlap test against NaN is false — silently ignoring the leave).
        if (lv.allDay || lv.startTime == null || lv.endTime == null) return 'time_off';
        if (overlaps(startMin, endMin, toMin(lv.startTime), toMin(lv.endTime))) return 'time_off';
    }

    const shift = await Shift.findOne({ teamMember: member._id, date: key })
        .select('slots breaks').lean();

    if (shift) {
        // A shift REPLACES the weekly pattern for that date.
        const onShift = (shift.slots || []).some(sl => startMin >= toMin(sl.start) && endMin <= toMin(sl.end));
        if (!onShift) return 'off_shift';
        if ((shift.breaks || []).some(b => overlaps(startMin, endMin, toMin(b.start), toMin(b.end)))) {
            return 'on_break';
        }
        return null;
    }

    // Their own weekly hours. pickRotationWeek collapses a rotating schedule to
    // the week that applies on this date; for a non-rotating doc it is exactly
    // staffAv.schedule. No doc = no hours of their own = not bookable.
    const staffAv = await StaffAvailability.findOne({ teamMember: member._id });
    const schedule = pickRotationWeek(staffAv, date);
    if (!schedule) return 'no_hours';
    if (!withinSchedule(schedule, date, startMin, endMin)) return 'outside_hours';
    return null;
}

async function isMemberFree({ providerId, member, date, startTime, endTime, svc, enforceHours }) {
    const startMin = toMin(startTime);
    const endMin = toMin(endTime);

    if (enforceHours) {
        const hoursReason = await staffHoursReason({ member, date, startTime, endTime });
        if (hoursReason) return { free: false, reason: hoursReason };
        const blocks = await BlockedTime.find({
            provider: providerId,
            date: dateStr(date),
            // Business-wide + this member's own blocks. Owner-only blocks
            // (teamMember null, ownerOnly) must NOT close a team member's day.
            $or: [{ teamMember: null, ownerOnly: { $ne: true } }, { teamMember: member._id }],
        }).select('startTime endTime');
        if (blocks.some(b => overlaps(startMin, endMin, toMin(b.startTime), toMin(b.endTime)))) {
            return { free: false, reason: 'blocked' };
        }
    }

    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    const existing = await Appointment.find({
        provider: providerId,
        ...memberInvolvedFilter(member._id),
        appointmentDate: { $gte: dayStart, $lte: dayEnd },
        status: { $nin: ['cancelled'] },
    }).select('startTime endTime services teamMember service');
    const nStart = startMin - (svc?.bufferBefore || 0);
    const nEnd = endMin + (svc?.bufferAfter || 0);
    // Per-segment: a member is busy only over their own segment windows, so a
    // colleague sharing a multi-service ticket doesn't falsely block them — and,
    // the double-booking this closes, a segment-only performer IS now seen. Each
    // existing window is widened by ITS service's buffers too, so an earlier
    // booking's cleanup time blocks this one regardless of which was booked first.
    const bufferByService = await bufferMapForAppointments(existing);
    const clash = existing.some(a => memberBusyIntervalsBuffered(a, member._id, bufferByService).some(([s, e]) => overlaps(nStart, nEnd, s, e)));
    if (clash) return { free: false, reason: 'booked' };
    return { free: true };
}

/**
 * "Any available": the earliest-created performer who is free for [startTime,
 * endTime]. A per-member isMemberFree loop issued ~6 sequential queries PER
 * performer (TimeOff/Shift/StaffAvailability/BlockedTime/Appointment/Service),
 * all awaited serially under the booking lock — ~60 round-trips for a 10-person
 * roster. This batch-loads the whole day in ONE Promise.all of $in queries
 * (like anyAvailableBusy) and evaluates each performer IN MEMORY with the exact
 * same predicates staffHoursReason + isMemberFree use (leave → shift replaces
 * weekly → their own weekly hours, none = skipped; business-wide + own blocks;
 * buffered, segment-aware appointment clash).
 *
 * Each performer is tested for THEIR OWN window: `endFor(member)` gives the end
 * of the booking if that person does it (their duration override can make it
 * longer than the posted window). Checking every performer against the posted
 * window booked a 120-minute member for a 60-minute slot, straight into their
 * next booking. Returns { memberId, endTime } for the first performer who is
 * free for their whole window, else { memberId: null, reason } — reason
 * 'booked' when someone was rostered and clear of blocks but already booked.
 */
async function firstFreePerformer({ providerId, performers, date, startTime, endTime, endFor, svc, businessSchedule }) {
    const key = dateStr(date);
    const startMin = toMin(startTime);
    const postedEndMin = toMin(endTime);
    const ids = performers.map(m => m._id);
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    const [shifts, staffAvs, leaves, blocks, appts] = await Promise.all([
        Shift.find({ teamMember: { $in: ids }, date: key }).select('teamMember slots breaks').lean(),
        StaffAvailability.find({ teamMember: { $in: ids } }).select('teamMember schedule rotation').lean(),
        TimeOff.find({
            teamMember: { $in: ids }, status: 'approved',
            startDate: { $lte: key }, endDate: { $gte: key },
        }).select('teamMember allDay startTime endTime').lean(),
        // Business-wide (not owner-only) + each performer's own blocks — the same
        // scope isMemberFree checks, widened to all performers via $in.
        BlockedTime.find({
            provider: providerId, date: key,
            $or: [{ teamMember: null, ownerOnly: { $ne: true } }, { teamMember: { $in: ids } }],
        }).select('teamMember startTime endTime').lean(),
        Appointment.find({
            provider: providerId,
            $or: [{ teamMember: { $in: ids } }, { 'services.teamMember': { $in: ids } }],
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            status: { $nin: ['cancelled'] },
        }).select('startTime endTime services teamMember service').lean(),
    ]);
    const bufferByService = await bufferMapForAppointments(appts);

    const shiftBy = {}; shifts.forEach(s => { shiftBy[String(s.teamMember)] = s; });
    // Store the whole doc (schedule + rotation) so the rotation week can be
    // selected per date below, not just the flat schedule.
    const avBy = {}; staffAvs.forEach(a => { avBy[String(a.teamMember)] = a; });
    const leavesBy = {}; leaves.forEach(lv => { (leavesBy[String(lv.teamMember)] = leavesBy[String(lv.teamMember)] || []).push(lv); });
    const businessBlocks = blocks.filter(b => !b.teamMember);            // teamMember null ⇒ business-wide (owner-only already excluded by the query)
    const memberBlocksBy = {}; blocks.forEach(b => { if (b.teamMember) (memberBlocksBy[String(b.teamMember)] = memberBlocksBy[String(b.teamMember)] || []).push(b); });

    const nStart = startMin - (svc?.bufferBefore || 0);
    let anyBooked = false;

    for (const member of performers) {
        const k = String(member._id);
        const memberEnd = endFor ? endFor(member) : endTime;
        const endMin = toMin(memberEnd);
        if (!(endMin > startMin)) continue;
        // A window longer than the posted one was never business-hours checked
        // upstream ("any" bookings are gated by the business hours) — check the
        // extension here so a slower performer can't be booked past closing.
        if (endMin > postedEndMin && businessSchedule && !withinSchedule(businessSchedule, date, startMin, endMin)) continue;
        const nEnd = endMin + (svc?.bufferAfter || 0);
        // 1. Approved leave overrides everything (all-day or windowed).
        const memberLeaves = leavesBy[k] || [];
        if (memberLeaves.some(lv => (lv.allDay || lv.startTime == null || lv.endTime == null)
            || overlaps(startMin, endMin, toMin(lv.startTime), toMin(lv.endTime)))) continue;
        // 2. Rostered hours: a shift REPLACES the weekly pattern for the date.
        const shift = shiftBy[k];
        if (shift) {
            const onShift = (shift.slots || []).some(sl => startMin >= toMin(sl.start) && endMin <= toMin(sl.end));
            if (!onShift) continue;
            if ((shift.breaks || []).some(b => overlaps(startMin, endMin, toMin(b.start), toMin(b.end)))) continue;
        } else {
            // Their own weekly hours; none of their own = not bookable (staffHoursReason).
            const schedule = pickRotationWeek(avBy[k], date);
            if (!schedule || !withinSchedule(schedule, date, startMin, endMin)) continue;
        }
        // 3. Blocked time: business-wide + this member's own.
        if (businessBlocks.some(b => overlaps(startMin, endMin, toMin(b.startTime), toMin(b.endTime)))) continue;
        if ((memberBlocksBy[k] || []).some(b => overlaps(startMin, endMin, toMin(b.startTime), toMin(b.endTime)))) continue;
        // 4. Existing appointments, buffered + segment-aware.
        const clash = appts.some(a => overlapsAny(nStart, nEnd, memberBusyIntervalsBuffered(a, member._id, bufferByService)));
        if (clash) { anyBooked = true; continue; }
        return { memberId: member._id, endTime: memberEnd };
    }
    return { memberId: null, reason: anyBooked ? 'booked' : 'unavailable' };
}

/**
 * Resolve which staff member (if any) a new booking lands on.
 * Returns { teamMember: ObjectId|null, endTime? } or { status, error } for
 * rejection. `endFor(member)` is the booking's end if that member performs it
 * (their own duration); "any available" tests each performer against their own
 * window and returns the chosen one's endTime. A clash with an existing booking
 * is a 409; hours, leave and blocks stay 400.
 */
async function resolveBookingStaff({ svc, providerId, appointmentDate, startTime, endTime, endFor, requestedTeamMember, requester }) {
    // Customer-side resolution (validate a requested member / pick "any available")
    // applies to EVERYONE except the provider who owns this business. Keying on
    // role==='customer' alone let a 'staff' (or another business's provider, or an
    // admin) resolve straight to the owner column with no validation — the resolver
    // half of the staff-role booking bypass. Ownership, not role, unlocks the
    // provider path.
    const isCustomer = !(requester.role === 'provider' && requester._id
        && String(requester._id) === String(providerId));
    // `bookable` gates who clients can be sent to; isActive gates who still works
    // here. A receptionist is active but not bookable, and must never be resolved
    // as "any available". Both default true, so an existing roster is unchanged.
    // isActive gates who still works here; `bookable` gates who CLIENTS may be
    // sent to. The roster keeps everyone active, because a provider logging a
    // walk-in under their receptionist must still resolve — filtering here broke
    // that override and returned "Unknown team member" for a member the business
    // dashboard was still offering.
    const roster = await TeamMember.find({ provider: providerId, isActive: true }).sort({ createdAt: 1 });
    const bookableRoster = roster.filter(m => m.bookable !== false);

    // Zero-staff business — the owner is the only professional. A client can
    // still only book them for something they actually offer: a service a
    // (since departed) team member added for themselves has nobody to do it.
    if (!roster.length) {
        if (requestedTeamMember) return { status: 400, error: 'Unknown team member', reason: 'unknown_member' };
        if (isCustomer && !ownerPerforms(svc)) return NO_PERFORMER;
        return { teamMember: null };
    }

    // No "solo member" exception any more. It dated from when the owner was their
    // own TeamMember (#121) and let a business's ONE bookable member be booked over
    // the business hours with a leftover or missing schedule. Since the owner became
    // the null column (#144) it only ever applied to a real team member, and it is
    // exactly what the owner asked to end: a member without hours of their own is
    // not bookable, however small the team. Every member is held to their own hours.
    // The business hours still cap "any available" (a slower performer's longer
    // window is checked against closing in firstFreePerformer).
    const availabilityDoc = await Availability.findOne({ provider: providerId });
    const businessSchedule = availabilityDoc?.schedule || null;

    // Explicit owner column: once a business has a roster, the owner is offered
    // to customers as a professional ("you") alongside staff. Booking them stores
    // the appointment unassigned (teamMember:null) — the create/reschedule paths
    // enforce business hours, blocked time and the owner's own (unassigned)
    // bookings against that null column, so resolve straight to it and skip the
    // "any available" staff pick below.
    //
    // Held to the same rule as a named member: the owner must perform the
    // service. Without it a client could book the owner for a service only a
    // team member offers — at that member's price, landing on the owner's own
    // calendar. The owner themselves keeps the walk-in override (their own
    // column is theirs to fill), exactly as for hours and blocks.
    if (requestedTeamMember && String(requestedTeamMember) === 'owner') {
        if (isCustomer && !ownerPerforms(svc)) {
            return { status: 400, error: 'That professional does not offer this service', reason: 'staff_service_mismatch' };
        }
        return { teamMember: null };
    }

    if (requestedTeamMember) {
        const member = roster.find(m => m._id.toString() === String(requestedTeamMember));
        if (!member) return { status: 400, error: 'Unknown team member', reason: 'unknown_member' };
        if (isCustomer) {
            if (member.bookable === false) {
                return { status: 400, error: 'That staff member is not available for online booking', reason: 'not_bookable' };
            }
            if (!performsService(member, svc._id)) {
                return { status: 400, error: 'That staff member does not offer this service', reason: 'staff_service_mismatch' };
            }
            const check = await isMemberFree({
                providerId, member, date: appointmentDate, startTime, endTime, svc, enforceHours: true,
            });
            if (!check.free) return { status: check.reason === 'booked' ? 409 : 400, error: UNAVAILABLE_MESSAGES[check.reason], reason: check.reason };
        }
        // provider/admin: ownership proven via the roster; hours/blocks are overridable
        return { teamMember: member._id };
    }

    // Provider booking without a pick = the owner's own column, as today.
    if (!isCustomer) return { teamMember: null };

    // Customer, no pick, staff exist → "any available".
    const performers = bookableRoster.filter(m => performsService(m, svc._id));
    // No team member performs it: the owner does — but only if they offer it.
    if (!performers.length) return ownerPerforms(svc) ? { teamMember: null } : NO_PERFORMER;

    // Batched, in-memory equivalent of an isMemberFree loop — one Promise.all of
    // $in queries for the whole roster instead of ~6 sequential queries per member
    // under the booking lock (see firstFreePerformer).
    const chosen = await firstFreePerformer({
        providerId, performers, date: appointmentDate, startTime, endTime, endFor, svc, businessSchedule,
    });
    if (chosen.memberId) return { teamMember: chosen.memberId, endTime: chosen.endTime };
    return {
        status: chosen.reason === 'booked' ? 409 : 400,
        error: 'No staff member is available at that time. You can join the waiting list instead.',
        reason: 'no_staff_available',
    };
}

/**
 * The whole-day busy list for the "any professional" slot picker.
 *
 * The picker used to know only the business hours and the raw appointment list,
 * while the booking validator resolves per-staff hours, shifts, leave and blocks
 * — so it advertised slots nobody could take (hours the staff don't work) and
 * greyed out slots somebody COULD take (one member booked, a colleague free).
 * This computes what the validator will actually accept: a window is open iff at
 * least one bookable performer of the service is rostered and free in it.
 *
 * Mirrors resolveBookingStaff exactly, interval-wise instead of per-window:
 *   - performers = active, bookable, performs the service
 *   - each works their OWN hours: shift, else weekly hours; none = not rostered
 *   - shift replaces the weekly pattern; approved leave and breaks cut out
 *   - business hours cap everything ("any" bookings are business-hours gated
 *     upstream even when a shift runs later — only a NAMED member's shift may
 *     extend past closing)
 *   - business-wide blocks close every column; a member's own block only theirs
 *
 * Returns { applied: false } when no bookable member performs the service (the
 * owner-fallback books on the owner column — legacy view applies) so the caller
 * keeps today's behaviour. Otherwise { applied: true, busy, openStarts,
 * openings } where busy windows carry kind 'off_shift' (nobody rostered →
 * "Unavailable") or 'appointment' (rostered but everyone busy → "Taken",
 * waitlist applies), `openStarts` are described below, and `openings` are the
 * "HH:MM" starts of the working periods (within the business hours) of every
 * performer rostered that day — each period's exact opening time (08:30, or
 * 14:30 after a split day's break) is always a CANDIDATE start (the owner's
 * answer), where the picker would otherwise only offer whole hours; whether it
 * is open is still `openStarts`'s call.
 *
 * `appointments` is the day's already-fetched non-cancelled list, passed in so
 * the picker and this computation can never disagree about the day's bookings.
 *
 * Duration-aware, per performer. Merging everyone's free time and marking busy
 * only where NOBODY is free advertised starts no single person could take for
 * the whole service (Hilda free 13:00–14:30 + Erastus free 15:00–17:00 read as
 * "14:00 open" for a 2-hour service). Now each performer contributes only the
 * starts at which THEY can do the whole service at THEIR length (`duration` is
 * the length the client will post — menu or option plus add-ons; a performer's
 * own override replaces the menu part). The result carries:
 *   busy       — for clients that test a [start, start+duration) window:
 *                everything outside the union of the per-performer windows;
 *   openStarts — the exact start ranges (inclusive, HH:MM) at which at least
 *                one performer can take the whole booking.
 */
async function anyAvailableBusy({ providerId, svc, date, appointments, duration, optionName }) {
    const key = dateStr(date);
    const roster = await TeamMember.find({ provider: providerId, isActive: true }).sort({ createdAt: 1 });
    const bookableRoster = roster.filter(m => m.bookable !== false);
    const performers = bookableRoster.filter(m => performsService(m, svc._id));
    if (!performers.length) {
        // The owner-column fallback only exists when the owner offers the
        // service; otherwise nobody can take any slot (resolveBookingStaff
        // refuses with no_performer), so say so instead of advertising the
        // owner's free time.
        if (ownerPerforms(svc)) return { applied: false };
        return { applied: true, busy: [{ startTime: '00:00', endTime: hhmmOf(DAY_END), kind: 'off_shift' }] };
    }

    const ids = performers.map(m => m._id);

    const [availabilityDoc, shifts, staffAvs, leaves, blocks] = await Promise.all([
        Availability.findOne({ provider: providerId }),
        Shift.find({ provider: providerId, teamMember: { $in: ids }, date: key }).select('teamMember slots breaks').lean(),
        StaffAvailability.find({ teamMember: { $in: ids } }).select('teamMember schedule rotation').lean(),
        TimeOff.find({
            provider: providerId, teamMember: { $in: ids }, status: 'approved',
            startDate: { $lte: key }, endDate: { $gte: key },
        }).select('teamMember allDay startTime endTime').lean(),
        BlockedTime.find({ provider: providerId, date: key }).select('teamMember ownerOnly startTime endTime').lean(),
    ]);

    const businessSchedule = availabilityDoc?.schedule || null;
    const businessDay = scheduleDayIntervals(businessSchedule, date);
    const byMember = (list) => {
        const m = {};
        list.forEach((x) => { const k = String(x.teamMember); (m[k] = m[k] || []).push(x); });
        return m;
    };
    // Widen existing bookings by their service buffers so the picker greys out
    // the same cleanup time the validator now reserves (isMemberFree) — otherwise
    // it would advertise a flush slot the booking is then refused.
    const bufferByService = await bufferMapForAppointments(appointments || []);
    const shiftBy = {}; shifts.forEach((s) => { shiftBy[String(s.teamMember)] = s; });
    const avBy = {}; staffAvs.forEach((a) => { avBy[String(a.teamMember)] = a; });
    const leavesBy = byMember(leaves);
    // Owner-only blocks (teamMember null, ownerOnly) belong to the owner alone —
    // they must not grey out any team member's availability here.
    const businessBlocks = blocks.filter(b => !b.teamMember && !b.ownerOnly).map(b => [toMin(b.startTime), toMin(b.endTime)]);
    const memberBlocksBy = byMember(blocks.filter(b => b.teamMember));

    // The client's window length, and each performer's own length for the same
    // booking (their override replaces the menu part; add-ons stay as sent).
    const option = optionName ? (svc.options || []).find((o) => o.name === optionName) || null : null;
    const menuMinutes = performerMinutes({ svc, member: null, option });
    const clientMinutes = Number(duration) > 0 ? Math.round(Number(duration)) : menuMinutes;
    const addOnMinutes = Math.max(0, clientMinutes - menuMinutes);

    const rosteredAll = [];
    const freeAll = [];
    const fitAll = [];    // [a, lastStart + clientMinutes): a client window inside it is one performer's whole booking
    const startsAll = []; // [firstStart, lastStart], inclusive
    const openings = new Set();
    for (const m of performers) {
        const k = String(m._id);
        const shift = shiftBy[k];
        let working;
        let periods; // the working periods themselves (a break is busy, not a new period)
        if (shift) {
            periods = (shift.slots || []).map(sl => [toMin(sl.start), toMin(sl.end)]);
            working = subtractIntervals(periods, (shift.breaks || []).map(b => [toMin(b.start), toMin(b.end)]));
        } else {
            // Their own weekly hours; none of their own = not rostered at all.
            const schedule = pickRotationWeek(avBy[k], date);
            working = schedule ? scheduleDayIntervals(schedule, date) : [];
            periods = working;
        }
        const leaveCuts = (leavesBy[k] || []).map(lv => (
            // A windowed leave with missing times is all-day, matching staffHoursReason.
            (lv.allDay || lv.startTime == null || lv.endTime == null) ? [0, DAY_END] : [toMin(lv.startTime), toMin(lv.endTime)]
        ));
        // Business hours cap; business-wide blocks close every column.
        const rostered = subtractIntervals(
            subtractIntervals(intersectIntervals(working, businessDay), leaveCuts),
            businessBlocks
        );
        // Each working period's opening time, when this performer is actually
        // rostered then (not on leave, not closed by a business-wide block).
        intersectIntervals(periods, businessDay).forEach(([s]) => {
            if (rostered.some(([a, b]) => s >= a && s < b)) openings.add(s);
        });
        const ownBlocks = (memberBlocksBy[k] || []).map(b => [toMin(b.startTime), toMin(b.endTime)]);
        const apptBusy = [];
        (appointments || []).forEach((a) => memberBusyIntervalsBuffered(a, m._id, bufferByService).forEach((iv) => apptBusy.push(iv)));
        rosteredAll.push(...rostered);
        freeAll.push(...subtractIntervals(rostered, [...ownBlocks, ...apptBusy]));
        // Where can THIS performer start the whole booking? Exactly what the
        // validator (firstFreePerformer) accepts: [s, s + need) inside their
        // working time, and — widened by the incoming service's own buffers —
        // clear of their (buffered) bookings. Widening a booking [x, y) to
        // [x - bufferAfter, y + bufferBefore) turns the second test into a plain
        // overlap on [s, s + need).
        const need = performerMinutes({ svc, member: m, option, addOnMinutes });
        const startable = subtractIntervals(
            subtractIntervals(rostered, ownBlocks),
            apptBusy.map(([x, y]) => [x - (svc.bufferAfter || 0), y + (svc.bufferBefore || 0)]),
        );
        startable.forEach(([a, b]) => {
            if (b - a >= need) {
                startsAll.push([a, b - need]);
                fitAll.push([a, b - need + clientMinutes]);
            }
        });
    }

    const rostered = mergeIntervals(rosteredAll);
    const booked = subtractIntervals(rostered, mergeIntervals(freeAll)); // rostered, but everyone occupied
    const fit = mergeIntervals(fitAll);
    const busy = [];
    // Nobody rostered → "Unavailable" (no waitlist: there is no one to wait for).
    const offShift = subtractIntervals([[0, DAY_END]], rostered);
    subtractIntervals(offShift, fit).forEach(([s, e]) => {
        busy.push({ startTime: hhmmOf(s), endTime: hhmmOf(e), kind: 'off_shift' });
    });
    // Rostered, but nobody can START the whole booking there. Where that is down
    // to bookings it is "Taken" (the waitlist makes sense); where it is only the
    // end of the day or a block coming up it reads "Unavailable".
    subtractIntervals(subtractIntervals([[0, DAY_END]], offShift), fit).forEach(([s, e]) => {
        const nearBooking = booked.some(([bs, be]) => bs <= e && be >= s);
        busy.push({ startTime: hhmmOf(s), endTime: hhmmOf(e), kind: nearBooking ? 'appointment' : 'off_shift' });
    });
    // Closed ranges — a single-minute range (a gap exactly the service long) is kept.
    const openStarts = [];
    startsAll.sort((x, y) => x[0] - y[0]).forEach(([s, e]) => {
        const last = openStarts[openStarts.length - 1];
        if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
        else openStarts.push([s, e]);
    });
    return {
        applied: true,
        busy,
        openStarts: openStarts.map(([s, e]) => ({ start: hhmm(s), end: hhmm(Math.min(e, DAY_END - 1)) })),
        openings: [...openings].sort((a, b) => a - b).map(hhmmOf),
    };
}

/**
 * One person's working hours on one date, by the SAME rules the booking
 * validator applies (staffHoursReason + the business-hours gate), so a slot
 * picker can offer exactly the times a booking for them will be accepted in,
 * and the calendar can shade exactly the time they can't be booked.
 *
 *   member null            → the owner's own column: the business hours.
 *   approved all-day leave → closed (source 'leave').
 *   a shift for the date   → the shift's periods, which may run past closing
 *                            (source 'shift'); its breaks come back as `busy`.
 *   a weekly schedule      → that week's day (rotation-aware), capped by the
 *                            business hours (source 'weekly').
 *   neither                → closed (source 'none'): a member with no hours of
 *                            their own is not bookable. Nothing is inherited
 *                            from the business.
 *
 * `slots` null means "no hours set anywhere" (only the owner's column, when the
 * business never published hours: the validator applies no hours check then);
 * [] means closed that day. The weekday comes from the YYYY-MM-DD key in UTC,
 * never the server's local clock, so a server running in UTC reads a Windhoek
 * business's Saturday as Saturday.
 */
const dayOfKey = (key) => DAY_NAMES[new Date(`${key}T00:00:00.000Z`).getUTCDay()];
const daySlotsOf = (schedule, key) => {
    if (!schedule) return null;
    const day = schedule[dayOfKey(key)];
    if (!day?.enabled || !Array.isArray(day.slots)) return [];
    return day.slots
        .filter((s) => s?.start && s?.end && toMin(s.end) > toMin(s.start))
        .map((s) => [toMin(s.start), toMin(s.end)])
        .sort((a, b) => a[0] - b[0]);
};
const intersect = (a, b) => {
    const out = [];
    a.forEach(([s1, e1]) => b.forEach(([s2, e2]) => {
        const s = Math.max(s1, s2); const e = Math.min(e1, e2);
        if (e > s) out.push([s, e]);
    }));
    return out.sort((x, y) => x[0] - y[0]);
};
const hhmmPlain = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const periodsOf = (list) => (list === null ? null : list.map(([s, e]) => ({ start: hhmmPlain(s), end: hhmmPlain(e) })));
const isAllDayLeave = (lv) => lv.allDay || lv.startTime == null || lv.endTime == null;

/**
 * The pure half of memberDayHours: one person's hours on `key` from rows the
 * caller already loaded (so the batch endpoint and the single one can never
 * disagree). `leaves` are this member's approved leaves covering `key`.
 */
function resolveDayHours({ key, member, businessSchedule, leaves = [], shift = null, staffAv = null }) {
    const business = daySlotsOf(businessSchedule || null, key);
    const base = { date: key, day: dayOfKey(key), business: periodsOf(business), busy: [] };
    if (!member) return { ...base, source: 'business', slots: periodsOf(business) };

    if (leaves.some(isAllDayLeave)) return { ...base, source: 'leave', slots: [] };
    const busy = leaves.map((lv) => ({ startTime: lv.startTime, endTime: lv.endTime, kind: 'time_off' }));

    if (shift) {
        const slots = (shift.slots || []).filter((s) => s?.start && s?.end && toMin(s.end) > toMin(s.start))
            .map((s) => ({ start: s.start, end: s.end }))
            .sort((a, b) => toMin(a.start) - toMin(b.start));
        (shift.breaks || []).forEach((b) => busy.push({ startTime: b.start, endTime: b.end, kind: 'break' }));
        return { ...base, source: 'shift', slots, busy };
    }

    const week = pickRotationWeek(staffAv, key);
    if (!week) return { ...base, source: 'none', slots: [], busy };
    const own = daySlotsOf(week, key);
    return { ...base, source: 'weekly', own: periodsOf(own), slots: periodsOf(business === null ? own : intersect(own, business)), busy };
}

async function memberDayHours({ providerId, member, date }) {
    const key = dateStr(date);
    const availabilityDoc = await Availability.findOne({ provider: providerId }).select('schedule').lean();
    const businessSchedule = availabilityDoc?.schedule || null;
    if (!member) return resolveDayHours({ key, member: null, businessSchedule });
    const [leaves, shift, staffAv] = await Promise.all([
        TimeOff.find({
            teamMember: member._id, status: 'approved', startDate: { $lte: key }, endDate: { $gte: key },
        }).select('allDay startTime endTime').lean(),
        Shift.findOne({ teamMember: member._id, date: key }).select('slots breaks').lean(),
        StaffAvailability.findOne({ teamMember: member._id }).select('schedule rotation').lean(),
    ]);
    return resolveDayHours({ key, member, businessSchedule, leaves, shift, staffAv });
}

/** 'YYYY-MM-DD' keys from `from` to `to` inclusive (UTC day steps). */
const dateKeysBetween = (from, to) => {
    const out = [];
    for (let d = new Date(`${from}T00:00:00.000Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
};

/**
 * Batch memberDayHours: several people's hours over a short range in ONE
 * Promise.all of $in queries — the calendar shades every lane from this, and
 * must not cost a request (or ~5 queries) per lane per render. `memberIds` must
 * already be scoped to `providerId`'s roster by the caller; any id that isn't a
 * member of this business is dropped here as well.
 *
 * Returns { owner: { [key]: dayHours } | undefined, members: { [id]: { [key]: dayHours } } }.
 */
async function teamDayHours({ providerId, memberIds = [], includeOwner = true, from, to }) {
    const keys = dateKeysBetween(from, to);
    const [availabilityDoc, members] = await Promise.all([
        Availability.findOne({ provider: providerId }).select('schedule').lean(),
        memberIds.length
            ? TeamMember.find({ provider: providerId, _id: { $in: memberIds } }).select('_id').lean()
            : [],
    ]);
    const ids = members.map((m) => m._id);
    const [shifts, leaves, staffAvs] = ids.length ? await Promise.all([
        Shift.find({ teamMember: { $in: ids }, date: { $gte: from, $lte: to } }).select('teamMember date slots breaks').lean(),
        TimeOff.find({
            teamMember: { $in: ids }, status: 'approved', startDate: { $lte: to }, endDate: { $gte: from },
        }).select('teamMember startDate endDate allDay startTime endTime').lean(),
        StaffAvailability.find({ teamMember: { $in: ids } }).select('teamMember schedule rotation').lean(),
    ]) : [[], [], []];
    const businessSchedule = availabilityDoc?.schedule || null;
    const shiftBy = {}; shifts.forEach((s) => { shiftBy[`${s.teamMember}|${s.date}`] = s; });
    const avBy = {}; staffAvs.forEach((a) => { avBy[String(a.teamMember)] = a; });

    const out = { members: {} };
    if (includeOwner) {
        out.owner = {};
        keys.forEach((key) => { out.owner[key] = resolveDayHours({ key, member: null, businessSchedule }); });
    }
    members.forEach((m) => {
        const k = String(m._id);
        const mine = leaves.filter((lv) => String(lv.teamMember) === k);
        out.members[k] = {};
        keys.forEach((key) => {
            out.members[k][key] = resolveDayHours({
                key, member: m, businessSchedule,
                leaves: mine.filter((lv) => lv.startDate <= key && lv.endDate >= key),
                shift: shiftBy[`${k}|${key}`] || null,
                staffAv: avBy[k] || null,
            });
        });
    });
    return out;
}

// ── Readiness: can this member be booked at all? ─────────────────────────────
// "Has hours" = weekly hours with at least one working period on some day (in
// any week of an active rotation), or a shift with a working period today or
// later. Enabled-but-empty days (the schema's defaults) don't count: a member
// whose only "hours" are those can't be booked at any time.
const weekHasHours = (week) => !!week && DAY_NAMES.some((d) => {
    const day = week[d];
    return !!day?.enabled && Array.isArray(day.slots)
        && day.slots.some((s) => s?.start && s?.end && toMin(s.end) > toMin(s.start));
});
const availabilityHasHours = (doc) => {
    if (!doc) return false;
    const rot = doc.rotation;
    const weeks = rot && Array.isArray(rot.weeks) ? rot.weeks : [];
    if (weeks.length && rot.anchor) return weeks.some(weekHasHours);
    return weekHasHours(doc.schedule);
};
// Today in the business's wall clock (Africa/Windhoek), as the Shift keys are.
const businessTodayKey = () => {
    const { NAMIBIA_OFFSET_MIN } = require('./appointmentTime');
    return new Date(Date.now() + NAMIBIA_OFFSET_MIN * 60000).toISOString().slice(0, 10);
};

/**
 * Map memberId → true/false: does each member have ANY hours of their own
 * (see above)? Two $in queries for the whole list. The owner is not a member
 * and always works the business hours, so callers treat the owner as ready.
 */
async function membersHoursReadiness(memberIds, { today } = {}) {
    const ids = (memberIds || []).map((id) => String(id));
    const out = new Map(ids.map((id) => [id, false]));
    if (!ids.length) return out;
    const todayKey = today || businessTodayKey();
    const [avs, shifts] = await Promise.all([
        StaffAvailability.find({ teamMember: { $in: ids } }).select('teamMember schedule rotation').lean(),
        Shift.find({ teamMember: { $in: ids }, date: { $gte: todayKey }, 'slots.0': { $exists: true } }).select('teamMember slots').lean(),
    ]);
    avs.forEach((a) => { if (availabilityHasHours(a)) out.set(String(a.teamMember), true); });
    shifts.forEach((s) => {
        if ((s.slots || []).some((sl) => sl?.start && sl?.end && toMin(sl.end) > toMin(sl.start))) out.set(String(s.teamMember), true);
    });
    return out;
}

module.exports = {
    memberDayHours, resolveDayHours, teamDayHours, dateKeysBetween, membersHoursReadiness, availabilityHasHours,
    resolveBookingStaff, isMemberFree, firstFreePerformer, performsService, ownerPerforms, staffHoursReason,
    memberBusyIntervals, memberBusyIntervalsBuffered, wholeSpanBuffered, bufferMapForAppointments,
    memberInvolvedFilter, ownerInvolvedFilter, laneInvolvedFilter, UNAVAILABLE_MESSAGES, anyAvailableBusy,
    pickRotationWeek, scheduleDayIntervals, withinSchedule, periodOpenings,
    overlapsAny, windowFits, performerMinutes,
};
