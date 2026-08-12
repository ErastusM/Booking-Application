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
const Appointment = require('../models/Appointment');
const Availability = require('../models/Availability');

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
};
const overlaps = (aS, aE, bS, bE) => aS < bE && aE > bS;
const dateStr = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));

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
async function staffHoursReason({ member, date, startTime, endTime, businessSchedule }) {
    if (!member) return null;                 // owner's own column — no staff hours apply
    const startMin = toMin(startTime);
    const endMin = toMin(endTime);

    const shift = await Shift.findOne({ teamMember: member._id, date: dateStr(date) })
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

    const staffAv = await StaffAvailability.findOne({ teamMember: member._id });
    const schedule = staffAv?.schedule || businessSchedule;
    if (schedule && !withinSchedule(schedule, date, startMin, endMin)) return 'outside_hours';
    return null;
}

async function isMemberFree({ providerId, member, date, startTime, endTime, svc, businessSchedule, enforceHours }) {
    const startMin = toMin(startTime);
    const endMin = toMin(endTime);

    if (enforceHours) {
        const hoursReason = await staffHoursReason({ member, date, startTime, endTime, businessSchedule });
        if (hoursReason) return { free: false, reason: hoursReason };
        const blocks = await BlockedTime.find({
            provider: providerId,
            date: dateStr(date),
            $or: [{ teamMember: null }, { teamMember: member._id }],
        }).select('startTime endTime');
        if (blocks.some(b => overlaps(startMin, endMin, toMin(b.startTime), toMin(b.endTime)))) {
            return { free: false, reason: 'blocked' };
        }
    }

    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    const existing = await Appointment.find({
        provider: providerId,
        teamMember: member._id,
        appointmentDate: { $gte: dayStart, $lte: dayEnd },
        status: { $nin: ['cancelled'] },
    }).select('startTime endTime');
    const nStart = startMin - (svc?.bufferBefore || 0);
    const nEnd = endMin + (svc?.bufferAfter || 0);
    if (existing.some(a => overlaps(nStart, nEnd, toMin(a.startTime), toMin(a.endTime)))) {
        return { free: false, reason: 'booked' };
    }
    return { free: true };
}

/**
 * Resolve which staff member (if any) a new booking lands on.
 * Returns { teamMember: ObjectId|null } or { status, error } for rejection.
 */
async function resolveBookingStaff({ svc, providerId, appointmentDate, startTime, endTime, requestedTeamMember, requester }) {
    const isCustomer = requester.role === 'customer';
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
        if (requestedTeamMember) return { status: 400, error: 'Unknown team member' };
        return { teamMember: null };
    }

    const availabilityDoc = await Availability.findOne({ provider: providerId });
    const businessSchedule = availabilityDoc?.schedule || null;

    if (requestedTeamMember) {
        const member = roster.find(m => m._id.toString() === String(requestedTeamMember));
        if (!member) return { status: 400, error: 'Unknown team member' };
        if (isCustomer) {
            if (member.bookable === false) {
                return { status: 400, error: 'That staff member is not available for online booking' };
            }
            if (!performsService(member, svc._id)) {
                return { status: 400, error: 'That staff member does not offer this service' };
            }
            const check = await isMemberFree({
                providerId, member, date: appointmentDate, startTime, endTime, svc,
                businessSchedule, enforceHours: true,
            });
            if (!check.free) return { status: 400, error: UNAVAILABLE_MESSAGES[check.reason] };
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
            businessSchedule, enforceHours: true,
        });
        if (check.free) return { teamMember: member._id };
    }
    return { status: 400, error: 'No staff member is available at that time. You can join the waiting list instead.' };
}

module.exports = { resolveBookingStaff, isMemberFree, performsService, staffHoursReason, UNAVAILABLE_MESSAGES };
