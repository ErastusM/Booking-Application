/**
 * Per-staff booking math (DUAL_APP_SPEC.md §3.6).
 *
 * A slot is bookable for staff S / service V / date D iff it is
 *   1. within business hours            (enforced upstream for customers, as before)
 *   2. within S's hours                 (StaffAvailability, else inherit business hours)
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

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
};
const overlaps = (aS, aE, bS, bE) => aS < bE && aE > bS;
const dateStr = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));

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
        return appt.services
            .filter(s => String(s.teamMember) === id)
            .map(s => [toMin(s.startTime), toMin(s.endTime)]);
    }
    return String(appt.teamMember) === id ? [[toMin(appt.startTime), toMin(appt.endTime)]] : [];
};
// A member is involved in a booking as its top-level performer OR a segment one.
const memberInvolvedFilter = (memberId) => ({ $or: [{ teamMember: memberId }, { 'services.teamMember': memberId }] });

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
 * `memberId` null = the owner's own column (whole-ticket span). `bufferByService`
 * maps serviceId → { bufferBefore, bufferAfter } (see bufferMapForAppointments).
 */
const memberBusyIntervalsBuffered = (appt, memberId, bufferByService = {}) => {
    const widen = (s, e, svcId) => {
        const b = bufferByService[String(svcId)] || {};
        return [s - (b.bufferBefore || 0), e + (b.bufferAfter || 0)];
    };
    if (memberId == null) {
        return [widen(toMin(appt.startTime), toMin(appt.endTime), appt.service)];
    }
    const id = String(memberId);
    if (Array.isArray(appt.services) && appt.services.length) {
        return appt.services
            .filter(s => String(s.teamMember) === id)
            .map(s => widen(toMin(s.startTime), toMin(s.endTime), s.service));
    }
    return String(appt.teamMember) === id ? [widen(toMin(appt.startTime), toMin(appt.endTime), appt.service)] : [];
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
// no hours constraint (mirrors staffHoursReason, which only rejects when a
// schedule exists); a schedule whose day is disabled means closed.
const scheduleDayIntervals = (schedule, date) => {
    if (!schedule) return [[0, DAY_END]];
    const day = schedule[DAY_NAMES[new Date(date).getDay()]];
    if (!day?.enabled || !Array.isArray(day.slots) || day.slots.length === 0) return [];
    return day.slots.map((s) => [toMin(s.start), toMin(s.end)]).filter(([a, b]) => b > a);
};

const withinSchedule = (schedule, date, startMin, endMin) => {
    const day = schedule?.[DAY_NAMES[new Date(date).getDay()]];
    if (!day?.enabled || !Array.isArray(day.slots) || day.slots.length === 0) return false;
    return day.slots.some(s => startMin >= toMin(s.start) && endMin <= toMin(s.end));
};

const performsService = (member, serviceId) =>
    !member.services?.length || member.services.map(String).includes(String(serviceId));

const UNAVAILABLE_MESSAGES = {
    outside_hours: "That time is outside this staff member's working hours.",
    off_shift: "That staff member isn't rostered on at that time.",
    on_break: 'That staff member is on a break at that time.',
    time_off: 'That staff member is on leave then.',
    blocked: 'That staff member is not available at that time.',
    booked: 'That staff member is already booked at that time. You can join the waiting list instead.',
};

/**
 * Steps 2–4 for one member. `businessSchedule` may be null (provider never
 * published hours) — then, matching the existing business-hours behavior,
 * no hours check applies unless the member has their own schedule.
 */
/**
 * Is this member ROSTERED to work that window? Shift, else weekly pattern,
 * else business hours — see the contract on models/Shift.
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
async function staffHoursReason({ member, date, startTime, endTime, businessSchedule, ignoreWeeklyHours }) {
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

    // A solo owner's own weekly schedule must not shrink the business day: fall
    // back to the business hours for the hours check (a leftover custom schedule is
    // ignored). Everything above — leave, shift, breaks — still applies, and the
    // caller still checks real bookings and blocked time, so this only widens the
    // hours window, never the conflict rules.
    const staffAv = ignoreWeeklyHours ? null : await StaffAvailability.findOne({ teamMember: member._id });
    const schedule = staffAv?.schedule || businessSchedule;
    if (schedule && !withinSchedule(schedule, date, startMin, endMin)) return 'outside_hours';
    return null;
}

async function isMemberFree({ providerId, member, date, startTime, endTime, svc, businessSchedule, enforceHours, ignoreWeeklyHours }) {
    const startMin = toMin(startTime);
    const endMin = toMin(endTime);

    if (enforceHours) {
        const hoursReason = await staffHoursReason({ member, date, startTime, endTime, businessSchedule, ignoreWeeklyHours });
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
 * Resolve which staff member (if any) a new booking lands on.
 * Returns { teamMember: ObjectId|null } or { status, error } for rejection.
 */
async function resolveBookingStaff({ svc, providerId, appointmentDate, startTime, endTime, requestedTeamMember, requester }) {
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

    // Zero-staff business — legacy provider-level behavior, untouched.
    if (!roster.length) {
        if (requestedTeamMember) return { status: 400, error: 'Unknown team member', reason: 'unknown_member' };
        return { teamMember: null };
    }

    const availabilityDoc = await Availability.findOne({ provider: providerId });
    const businessSchedule = availabilityDoc?.schedule || null;

    // Exactly one bookable member = effectively a solo business (the owner is their
    // own only bookable member). Such an owner must not be able to shrink their own
    // day below the business hours with a leftover per-staff WEEKLY schedule: custom
    // staff hours default to 09:00–17:00, so an owner who once opened "Set custom
    // hours" silently loses their evenings for online booking even though the shop
    // is open. So for a solo owner the working-hours check falls back to the
    // business hours (ignoreWeeklyHours) — their own weekly schedule is bypassed,
    // but this is done INSIDE the free check so a real clash, approved leave, a
    // break, a rostered day off and blocked time all still block. Business hours
    // themselves are still enforced (and upstream for customers). Two or more
    // bookable members = a real roster, unchanged.
    const soloOwner = bookableRoster.length === 1;

    // Explicit owner column: once a business has a roster, the owner is offered
    // to customers as a professional ("you") alongside staff. Booking them stores
    // the appointment unassigned (teamMember:null) — the create/reschedule paths
    // enforce business hours, blocked time and the owner's own (unassigned)
    // bookings against that null column, so resolve straight to it and skip the
    // "any available" staff pick below.
    if (requestedTeamMember && String(requestedTeamMember) === 'owner') {
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
                providerId, member, date: appointmentDate, startTime, endTime, svc,
                businessSchedule, enforceHours: true, ignoreWeeklyHours: soloOwner,
            });
            if (!check.free) return { status: 400, error: UNAVAILABLE_MESSAGES[check.reason], reason: check.reason };
        }
        // provider/admin: ownership proven via the roster; hours/blocks are overridable
        return { teamMember: member._id };
    }

    // Provider booking without a pick = the owner's own column, as today.
    if (!isCustomer) return { teamMember: null };

    // Customer, no pick, staff exist → "any available".
    const performers = bookableRoster.filter(m => performsService(m, svc._id));
    if (!performers.length) return { teamMember: null }; // nobody performs it => the owner does

    for (const member of performers) {
        const check = await isMemberFree({
            providerId, member, date: appointmentDate, startTime, endTime, svc,
            businessSchedule, enforceHours: true, ignoreWeeklyHours: soloOwner,
        });
        if (check.free) return { teamMember: member._id };
    }
    return { status: 400, error: 'No staff member is available at that time. You can join the waiting list instead.', reason: 'no_staff_available' };
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
 *   - solo owner (one bookable member) inherits business hours (#121)
 *   - shift replaces the weekly pattern; approved leave and breaks cut out
 *   - business hours cap everything ("any" bookings are business-hours gated
 *     upstream even when a shift runs later — only a NAMED member's shift may
 *     extend past closing)
 *   - business-wide blocks close every column; a member's own block only theirs
 *
 * Returns { applied: false } when no bookable member performs the service (the
 * owner-fallback books on the owner column — legacy view applies) so the caller
 * keeps today's behaviour. Otherwise { applied: true, busy: [...] } where busy
 * windows carry kind 'off_shift' (nobody rostered → "Unavailable") or
 * 'appointment' (rostered but everyone busy → "Taken", waitlist applies).
 *
 * `appointments` is the day's already-fetched non-cancelled list, passed in so
 * the picker and this computation can never disagree about the day's bookings.
 */
async function anyAvailableBusy({ providerId, svc, date, appointments }) {
    const key = dateStr(date);
    const roster = await TeamMember.find({ provider: providerId, isActive: true }).sort({ createdAt: 1 });
    const bookableRoster = roster.filter(m => m.bookable !== false);
    const performers = bookableRoster.filter(m => performsService(m, svc._id));
    if (!performers.length) return { applied: false };

    const soloOwner = bookableRoster.length === 1;
    const ids = performers.map(m => m._id);

    const [availabilityDoc, shifts, staffAvs, leaves, blocks] = await Promise.all([
        Availability.findOne({ provider: providerId }),
        Shift.find({ provider: providerId, teamMember: { $in: ids }, date: key }).select('teamMember slots breaks').lean(),
        soloOwner ? [] : StaffAvailability.find({ teamMember: { $in: ids } }).select('teamMember schedule').lean(),
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

    const rosteredAll = [];
    const freeAll = [];
    for (const m of performers) {
        const k = String(m._id);
        const shift = shiftBy[k];
        let working;
        if (shift) {
            working = subtractIntervals(
                (shift.slots || []).map(sl => [toMin(sl.start), toMin(sl.end)]),
                (shift.breaks || []).map(b => [toMin(b.start), toMin(b.end)])
            );
        } else {
            const schedule = soloOwner ? businessSchedule : (avBy[k]?.schedule || businessSchedule);
            working = scheduleDayIntervals(schedule, date);
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
        const cuts = (memberBlocksBy[k] || []).map(b => [toMin(b.startTime), toMin(b.endTime)]);
        (appointments || []).forEach((a) => memberBusyIntervalsBuffered(a, m._id, bufferByService).forEach((iv) => cuts.push(iv)));
        rosteredAll.push(...rostered);
        freeAll.push(...subtractIntervals(rostered, cuts));
    }

    const rostered = mergeIntervals(rosteredAll);
    const free = mergeIntervals(freeAll);
    const busy = [];
    // Nobody rostered → "Unavailable" (no waitlist: there is no one to wait for).
    subtractIntervals([[0, DAY_END]], rostered).forEach(([s, e]) => {
        busy.push({ startTime: hhmmOf(s), endTime: hhmmOf(e), kind: 'off_shift' });
    });
    // Rostered but everyone occupied → "Taken", the waitlist makes sense.
    subtractIntervals(rostered, free).forEach(([s, e]) => {
        busy.push({ startTime: hhmmOf(s), endTime: hhmmOf(e), kind: 'appointment' });
    });
    return { applied: true, busy };
}

module.exports = {
    resolveBookingStaff, isMemberFree, performsService, staffHoursReason,
    memberBusyIntervals, memberBusyIntervalsBuffered, bufferMapForAppointments,
    memberInvolvedFilter, UNAVAILABLE_MESSAGES, anyAvailableBusy,
};
