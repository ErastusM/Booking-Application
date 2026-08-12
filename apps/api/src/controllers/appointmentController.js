const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const { randomUUID } = require('crypto');
const Appointment = require('../models/Appointment');
const Availability = require('../models/Availability');
const Service = require('../models/Service');
const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const { createNotification, notifyAdmins } = require('../utils/notificationhelper');
const { apptPhrase, ApptPhrase, theirApptPhrase, servicePhrase } = require('../utils/apptCopy');
const walletService = require('../utils/walletService');
const {
    sendAppointmentConfirmed,
    sendAppointmentCompleted,
    sendAppointmentCancelled,
    sendAppointmentRescheduled,
    sendAppointmentRescheduledClient,
    sendRebookingPrompt,
} = require('../utils/emailService');
const calendarHelper = require('../utils/calendarHelper');
const { resolveBookingStaff, staffHoursReason, UNAVAILABLE_MESSAGES } = require('../utils/staffBooking');
const { overlapsBlockedTime, findBlocksForDate, findBlocksForDates, toDateKey, BLOCKED_MESSAGE } = require('../utils/blockedTime');
const { checkCancellationWindow } = require('../utils/cancellationPolicy');
const { realStartMs } = require('../utils/appointmentTime');
const { primaryOrigin } = require('../utils/origins');
const { can, CALENDAR_ALL } = require('../utils/permissions');

// Who a client-facing email/notification for this appointment should go to: the
// registered customer, or the guest who booked (customer is null for guests).
// Returns email:null when there's nobody to email (e.g. a provider walk-in).
const clientContact = (appt) => ({
    email: appt.customer?.email || appt.guestEmail || null,
    name: appt.customer?.name || appt.guestName || appt.walkInName || 'there',
    userId: appt.customer?._id || null, // in-app notifications only reach real accounts
});

const defaultSchedule = {
    monday:    { enabled: true,  slots: [{ start: '09:00', end: '17:00' }] },
    tuesday:   { enabled: true,  slots: [{ start: '09:00', end: '17:00' }] },
    wednesday: { enabled: true,  slots: [{ start: '09:00', end: '17:00' }] },
    thursday:  { enabled: true,  slots: [{ start: '09:00', end: '17:00' }] },
    friday:    { enabled: true,  slots: [{ start: '09:00', end: '17:00' }] },
    saturday:  { enabled: false, slots: [{ start: '09:00', end: '17:00' }] },
    sunday:    { enabled: false, slots: [{ start: '09:00', end: '17:00' }] },
};

const parseTimeToMinutes = (time) => {
    const [h, m] = String(time).split(':').map(Number);
    return h * 60 + m;
};

// Inverse of parseTimeToMinutes — clamps into a 24h day so a back-to-back
// multi-service span that crosses midnight still formats as HH:MM.
const minutesToTime = (mins) => {
    const m = (((mins % (24 * 60)) + 24 * 60) % (24 * 60));
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const timesOverlap = (startA, endA, startB, endB) => startA < endB && endA > startB;

// Every booking window must end after it starts, on the same day.
//
// Two real defects close here. (a) A window crossing midnight (23:00–01:00) used
// to be accepted for customers by adding 24h to the duration, but nothing
// downstream knows that: the schedule check re-derives the duration WITHOUT the
// +24h (so 23:00–01:00 reads as 60 minutes and passes a 09:00–17:00 day), and
// every overlap predicate is `newStart < aEnd && newEnd > aStart`, which is
// trivially false when newEnd (60) is below newStart (1380) — so the booking is
// invisible to every conflict check and auto-completes before it began.
// (b) Provider-created bookings skipped the duration check entirely, so an
// inverted window (09:00–08:00) could be saved, and it too is invisible to all
// future conflict checks, letting later bookings silently stack on top of it.
// Handling cross-midnight properly means fixing the schedule check, all three
// overlap predicates and realEndMs; rejecting it is the correct, safe answer
// until a booking legitimately needs to span midnight.
const validBookingWindow = (startTime, endTime) => {
    const s = parseTimeToMinutes(startTime);
    const e = parseTimeToMinutes(endTime);
    return Number.isFinite(s) && Number.isFinite(e) && e > s;
};

// True if the given date + start time is in the past (1-minute grace).
// Used to stop customers booking/rescheduling into a time that has already passed.
// Uses the shared Africa/Windhoek-aware instant so this agrees with the reminder
// cron and the cancellation window — a plain setHours() here read startTime as
// server-local (UTC), which made the check 2 hours off in production.
const isPastSlot = (appointmentDate, startTime) => {
    const t = realStartMs(appointmentDate, startTime);
    if (isNaN(t)) return false; // let other validation handle bad dates
    return t < Date.now() - 60 * 1000;
};

const getProviderSchedule = async (providerId) => {
    if (!providerId) return defaultSchedule;
    const availability = await Availability.findOne({ provider: providerId });
    return availability?.schedule || defaultSchedule;
};

/**
 * Does a specific member have a date-specific shift for this day?
 *
 * A Shift REPLACES business hours for that member on that date (models/Shift
 * precedence: shift → weekly pattern → business hours). So when a booking
 * targets a specific member who has a shift for the date, the business-wide
 * hours gate must stand down and let the per-staff check (staffHoursReason) be
 * the authority — otherwise a member rostered to cover a Sunday or work a late
 * evening can never be booked, which is the entire reason a shift exists. The
 * per-staff check still enforces the shift's own slots and breaks, so standing
 * the gate down never opens a slot the shift itself doesn't cover. "Any
 * available" (no member picked) keeps the business-hours gate as its funnel.
 */
const shiftGovernsHours = async (teamMemberId, appointmentDate) => {
    if (!teamMemberId) return false;
    const Shift = require('../models/Shift');
    return !!(await Shift.exists({ teamMember: teamMemberId, date: toDateKey(appointmentDate) }));
};

const isTimeWithinSchedule = (schedule, appointmentDate, startTime, durationMinutes) => {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayIndex = new Date(appointmentDate).getDay();
    const daySchedule = schedule[dayNames[dayIndex]];
    if (!daySchedule?.enabled || !Array.isArray(daySchedule.slots) || daySchedule.slots.length === 0) {
        return false;
    }
    const start = parseTimeToMinutes(startTime);
    const end = start + durationMinutes;
    return daySchedule.slots.some(slot => {
        const slotStart = parseTimeToMinutes(slot.start);
        const slotEnd = parseTimeToMinutes(slot.end);
        return start >= slotStart && end <= slotEnd;
    });
};

const hasConflictingAppointment = async (providerId, appointmentDate, startTime, endTime, excludeId, opts = {}) => {
    if (!providerId) return false;
    const { teamMember = null, bufferBefore = 0, bufferAfter = 0 } = opts;
    const start = new Date(appointmentDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(appointmentDate);
    end.setHours(23, 59, 59, 999);
    const existing = await Appointment.find({
        provider: providerId,
        appointmentDate: { $gte: start, $lte: end },
        status: { $nin: ['cancelled'] },
        // Per-staff: only the SAME member's bookings collide — different staff can
        // hold the same clock time, and teamMember null is the owner's own column.
        // Without this the check was provider-wide, so one colleague's booking made
        // that time unreschedulable for every other staff member (a slot the public
        // booking page happily sells fresh). Callers pass the appointment's own member.
        teamMember: teamMember || null,
        // Accepts one id or many: a batch reschedule has to ignore every booking
        // it is itself moving, or each move would "conflict" with its siblings'
        // stale positions. $nin with a single element behaves exactly like $ne.
        _id: { $nin: Array.isArray(excludeId) ? excludeId : [excludeId] },
    }).select('startTime endTime');
    // Expand the incoming booking by its service buffers so a reschedule can't land
    // flush against a booking whose service reserves cleanup time.
    const newStart = parseTimeToMinutes(startTime) - (bufferBefore || 0);
    const newEnd = parseTimeToMinutes(endTime) + (bufferAfter || 0);
    return existing.some(a => timesOverlap(newStart, newEnd, parseTimeToMinutes(a.startTime), parseTimeToMinutes(a.endTime)));
};

// The teamMember + buffers a reschedule/revival must check against — the moved
// booking's own assigned member and its service's cleanup buffers.
const conflictScope = (appointment) => ({
    teamMember: appointment.teamMember || null,
    bufferBefore: appointment.service?.bufferBefore || 0,
    bufferAfter: appointment.service?.bufferAfter || 0,
});

/**
 * Post-write conflict re-check for a reschedule, and roll back if it lost.
 *
 * createAppointment closes its check-then-insert race with a backstop after the
 * write; the reschedule paths had a conflict check followed by save() and nothing
 * after, so two moves onto the same slot — or a move racing a fresh booking —
 * could both commit and double-book. This re-checks once the new time is durable
 * and restores the previous slot if a clash is now visible.
 *
 * The mover is always treated as the loser: it has an old _id, so the create
 * backstop's "larger _id rolls back" tie-break would wrongly let it win against a
 * booking that was already there. If two reschedules race, both see each other and
 * both revert — nobody is double-booked, and both users are told to pick again,
 * which is the safe direction to fail.
 */
const revertRescheduleIfRaced = async (appointment, previousSlot) => {
    const providerId = appointment.provider || appointment.service?.provider;
    if (!providerId) return false;
    const clash = await hasConflictingAppointment(
        providerId,
        appointment.appointmentDate,
        appointment.startTime,
        appointment.endTime,
        appointment._id,
        conflictScope(appointment),
    );
    if (!clash) return false;
    appointment.appointmentDate = previousSlot.appointmentDate;
    appointment.startTime = previousSlot.startTime;
    appointment.endTime = previousSlot.endTime;
    await appointment.save();
    return true;
};

/**
 * Which dates of a recurring series can actually be booked?
 *
 * Only the FIRST occurrence used to be validated — the rest were inserted
 * blind, so a weekly series booked straight through the provider's blocked
 * days, and a daily one booked through closed weekends. Conflicting dates are
 * SKIPPED and the rest of the series still books: one clash three months out
 * shouldn't cost the customer the whole booking. The caller reports the
 * skipped dates back so nobody is surprised by a missing week.
 *
 * Batched into two queries, so a 60-occurrence series stays cheap.
 * `schedule`/blocked filtering is only applied for customer-like bookings —
 * providers keep the same override they have for a single booking — but an
 * overlapping APPOINTMENT is skipped for everyone, since nobody may double-book.
 */
const filterBookableOccurrences = async ({
    providerId, dates, startTime, endTime, teamMember, schedule, duration, enforceHoursAndBlocks,
}) => {
    if (!providerId || dates.length <= 1) return { kept: dates, skipped: [] };

    const keys = dates.map(toDateKey);
    const rangeStart = new Date(dates[0]); rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(dates[dates.length - 1]); rangeEnd.setHours(23, 59, 59, 999);

    const [blocks, appts] = await Promise.all([
        enforceHoursAndBlocks ? findBlocksForDates(providerId, keys, teamMember) : [],
        Appointment.find({
            provider: providerId,
            teamMember: teamMember || null,
            appointmentDate: { $gte: rangeStart, $lte: rangeEnd },
            status: { $nin: ['cancelled'] },
        }).select('appointmentDate startTime endTime').lean(),
    ]);

    const bucket = (arr, keyOf) => arr.reduce((m, x) => {
        const k = keyOf(x);
        (m[k] = m[k] || []).push(x);
        return m;
    }, {});
    const blocksByDate = bucket(blocks, b => b.date);
    const apptsByDate = bucket(appts, a => toDateKey(a.appointmentDate));

    const start = parseTimeToMinutes(startTime);
    const end = parseTimeToMinutes(endTime);
    const clashes = (list) => (list || []).some(x =>
        start < parseTimeToMinutes(x.endTime) && end > parseTimeToMinutes(x.startTime));

    const kept = [];
    const skipped = [];
    for (let i = 0; i < dates.length; i += 1) {
        const d = dates[i];
        const key = keys[i];
        // The first occurrence already passed the full booking checks above; never
        // drop it here, or a series could come back empty.
        if (i > 0) {
            const closedThatDay = enforceHoursAndBlocks && schedule
                && !isTimeWithinSchedule(schedule, d, startTime, duration);
            // Off-shift, on a rostered day off, or on a break for the assigned
            // member. A single booking is gated by staffHoursReason; a series
            // used to insert straight past it. Reuses the exact same gate (one
            // authority, a couple of queries per date on a rare write path) so
            // the two can't drift. Only for a specific member — null is the
            // owner's own column, which staff hours don't govern.
            const offForStaff = enforceHoursAndBlocks && teamMember
                ? await staffHoursReason({ member: { _id: teamMember }, date: d, startTime, endTime, businessSchedule: schedule })
                : null;
            if (closedThatDay || offForStaff || clashes(blocksByDate[key]) || clashes(apptsByDate[key])) {
                skipped.push(key);
                continue;
            }
        }
        kept.push(d);
    }

    return { kept, skipped };
};

/**
 * GET /api/appointments/booked-slots?providerId=&date=YYYY-MM-DD
 * Public — returns the start/end times a provider is UNAVAILABLE on a given date:
 * every non-cancelled appointment, plus every blocked time (lunch, day off,
 * recurring blocks). Used by the booking page to grey out unavailable slots.
 *
 * Blocked time is included because the slot list previously only knew about
 * appointments, so a blocked slot rendered as free and customers booked over it.
 * Each entry carries a `kind` so the UI can say "Taken" vs "Unavailable"; older
 * clients that ignore `kind` still treat every entry as busy, which is the
 * behaviour that matters.
 */
exports.getBookedSlots = async (req, res) => {
    try {
        const { providerId, date, teamMember } = req.query;
        if (!providerId || !date) {
            return res.status(400).json({ success: false, message: 'providerId and date are required' });
        }
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);

        const query = {
            provider: providerId,
            appointmentDate: { $gte: start, $lte: end },
            status: { $nin: ['cancelled'] },
        };
        // Additive: scope busy times to one staff member. Without it the query
        // stays provider-wide, exactly as before.
        if (teamMember) query.teamMember = teamMember;

        const Shift = require('../models/Shift');
        const [appointments, blocks, shift] = await Promise.all([
            Appointment.find(query).select('startTime endTime teamMember -_id').lean(),
            findBlocksForDate(providerId, date, teamMember || null),
            // Only meaningful for a named staff member: a shift is one person's
            // working day, so it says nothing about the business as a whole.
            teamMember ? Shift.findOne({ teamMember, date: toDateKey(date) }).select('slots breaks').lean() : null,
        ]);

        const busy = [
            ...appointments.map(a => ({ ...a, kind: 'appointment' })),
            ...blocks.map(b => ({ startTime: b.startTime, endTime: b.endTime, kind: 'blocked' })),
        ];

        // Breaks and off-shift hours have to come back as BUSY, not just be
        // enforced when the booking is submitted. Slots are computed on the
        // client from opening hours minus this list, so a break the client
        // never hears about is a slot the customer picks and is then refused —
        // the rejection is correct and the experience is terrible. Entries
        // carry a `kind`, and clients that ignore it still treat them as busy.
        if (shift) {
            (shift.breaks || []).forEach((b) => {
                busy.push({ startTime: b.start, endTime: b.end, kind: 'break' });
            });
            // The complement of the shift's slots across the day. A shift with
            // no slots is a rostered day off, and correctly blocks the lot.
            const mins = (t) => { const [h = 0, m = 0] = String(t).split(':').map(Number); return h * 60 + m; };
            const pad = (n) => String(n).padStart(2, '0');
            const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
            const ordered = (shift.slots || [])
                .map((sl) => [mins(sl.start), mins(sl.end)])
                .filter(([a, b]) => b > a)
                .sort((a, b) => a[0] - b[0]);
            let cursor = 0;
            ordered.forEach(([a, b]) => {
                if (a > cursor) busy.push({ startTime: hhmm(cursor), endTime: hhmm(a), kind: 'off_shift' });
                cursor = Math.max(cursor, b);
            });
            if (cursor < 24 * 60) busy.push({ startTime: hhmm(cursor), endTime: '23:59', kind: 'off_shift' });
        }

        res.status(200).json({
            success: true,
            data: busy,
            // A date-specific shift REPLACES business hours for that member on that
            // date (models/Shift), and may run beyond them. The customer slot
            // picker's base window is the provider's published hours, so without
            // this a shift extending past closing — a member rostered to cover a
            // late evening — could never be offered even though the server would
            // accept the booking. Returned only for a named member with a shift;
            // null means "no shift, use business hours as before". An empty array
            // is a rostered day off (no slots), distinct from null.
            shiftWindow: shift ? (shift.slots || []).map((s) => ({ start: s.start, end: s.end })) : null,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getAllAppointments = async (req, res) => {
    try {
        let query = {};
        if (req.user.role === 'customer') {
            query = { customer: req.user._id };
        } else if (req.user.role === 'staff') {
            // Never the whole platform — a staff principal is always confined to
            // the business they work for (the bare fall-through is admin-only).
            //
            // Within that business, how much they see is now a PERMISSION rather
            // than a hardcoded rule: `calendar:all` shows every colleague's
            // bookings, its absence narrows to their own column. Until this, a
            // staff member was pinned to self-only whatever the owner granted,
            // so the calendar-access setting had nothing to act on.
            if (!req.user.staffOf) return res.status(200).json({ success: true, data: [] });
            if (can(req.user, CALENDAR_ALL)) {
                query = { provider: req.user.staffOf };
            } else {
                const member = await TeamMember.findOne({ user: req.user._id, provider: req.user.staffOf });
                if (!member) return res.status(200).json({ success: true, data: [] });
                query = { provider: req.user.staffOf, teamMember: member._id };
            }
        } else if (req.user.role === 'provider') {
            query = { provider: req.user._id };
        }

        const { status } = req.query;
        if (status && ['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
            query.status = status;
        }

        // The provider calendar needs every booking, not a page — `all=true` bypasses
        // pagination so the calendar can never silently drop appointments.
        const fetchAll = req.query.all === 'true';
        // .lean() throughout: these are serialised straight to JSON and no
        // document method is ever called on them, so hydrating hundreds of
        // Mongoose documents (each with four populated relations) is pure cost
        // on the request the calendar waits for.
        const base = () => Appointment.find(query).lean()
            .populate('customer', 'name email phone')
            .populate('service', 'name price duration')
            .populate('teamMember', 'name color')
            .populate('services.teamMember', 'name color')
            .sort({ appointmentDate: -1 });

        if (fetchAll) {
            const appointments = await base();
            return res.status(200).json({
                success: true, count: appointments.length, total: appointments.length,
                page: 1, pages: 1, data: appointments,
            });
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [appointments, total] = await Promise.all([
            base().skip(skip).limit(limit),
            Appointment.countDocuments(query),
        ]);
        res.status(200).json({
            success: true,
            count: appointments.length,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: appointments,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getMyAppointments = async (req, res) => {
    try {
        const appointments = await Appointment.find({ customer: req.user._id })
            .populate('customer', 'name email phone')
            .populate({
                path: 'service',
                select: 'name price duration provider',
                // Pull the provider's business location (for "Getting there") plus their
                // avatar / first portfolio photo so the booking card can show the business
                // image — same picture customers see on the home feed.
                populate: { path: 'provider', select: 'name avatar businessProfile.businessName businessProfile.address businessProfile.locationType businessProfile.currency portfolio.images' },
            })
            .populate('teamMember', 'name')
            .sort({ appointmentDate: -1 });

        res.status(200).json({
            success: true,
            count: appointments.length,
            data: appointments,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * The `step`-th occurrence of a recurrence, measured from the ANCHOR date.
 *
 * Deliberately computed from the anchor rather than by walking forward from the
 * previous occurrence, because monthly recurrence cannot be done incrementally.
 * setMonth OVERFLOWS: from 31 Jan, +1 month asks for 31 Feb and JS rolls it to
 * 3 Mar. Stepping from that result, the series permanently migrates to early in
 * the month. Clamping each step to the month's last day is not enough either —
 * once 31 Jan becomes 28 Feb, stepping from the 28th keeps it there forever.
 * Counting months off the anchor and clamping only for display gives the calendar
 * behaviour people expect: 31 Jan → 28 Feb → 31 Mar → 30 Apr → 31 May.
 */
const occurrenceFromAnchor = (anchor, type, interval, step) => {
    const n = Math.max(1, parseInt(interval, 10) || 1) * step;
    const d = new Date(anchor);
    if (type === 'daily')  d.setDate(d.getDate() + n);
    if (type === 'weekly') d.setDate(d.getDate() + 7 * n);
    if (type === 'monthly') {
        const anchorDay = new Date(anchor).getDate();
        d.setDate(1); // park on a day every month has, so setMonth can't overflow
        d.setMonth(d.getMonth() + n);
        const lastDayOfTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(anchorDay, lastDayOfTarget));
    }
    return d;
};

exports.createAppointment = async (req, res) => {
    try {
        const { service, appointmentDate, startTime, endTime, notes, selectedAddOns, selectedOptionName, walkInName, customerId,
                isRecurring, recurrenceType, recurrenceInterval, recurrenceEndDate, teamMember, paymentMethod,
                guestName, guestEmail, guestPhone } = req.body;
        if (!service || !appointmentDate || !startTime || !endTime) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }
        if (!validBookingWindow(startTime, endTime)) {
            return res.status(400).json({ success: false, message: 'A booking must end after it starts, on the same day.' });
        }
        const svc = await Service.findById(service);
        if (!svc) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }
        // Guest checkout: no signed-in user (optionalAuth left req.user null). A
        // guest books like a customer but must supply contact details and can't
        // use provider-only powers (walk-in / book-on-behalf) or the wallet.
        const isGuest = !req.user;
        // Provider-override powers (log a walk-in, book on behalf, skip published
        // hours / blocked time / past dates) apply ONLY when the provider owns the
        // service. A provider booking ANOTHER business's service is just a customer
        // of that business and is treated exactly like one — otherwise they'd bypass
        // a stranger's schedule and blocked time and inject bookings onto that
        // calendar with no ownership check (audit #2). Ownership, not merely the
        // 'provider' role, is what unlocks the override.
        const ownsService = req.user?.role === 'provider' && svc.provider
            && String(svc.provider) === String(req.user._id);
        const isProviderBooking = ownsService;
        const isCustomerLike = isGuest || req.user?.role === 'customer'
            || (req.user?.role === 'provider' && !ownsService);

        // Customers, guests and providers book here; admins never did (the route
        // dropped authorize() for guest checkout, so re-assert that contract).
        if (req.user?.role === 'admin') {
            return res.status(403).json({ success: false, message: 'Admins cannot create bookings from here.' });
        }

        if (isGuest && (!guestName?.trim() || !guestEmail?.trim())) {
            return res.status(400).json({ success: false, message: 'Please provide your name and email to book as a guest.' });
        }

        // A provider booking from their calendar can either log a walk-in (free-text
        // name) or book on behalf of an existing registered client (customerId).
        // Resolve who the appointment is actually FOR, so the confirmation email,
        // reminders and in-app notice reach the real client — not the provider.
        // A guest booking is for the guest themselves (no account, contact captured).
        let bookingClient = isGuest
            ? { _id: null, name: guestName.trim(), email: guestEmail.trim(), phone: (guestPhone || '').trim() }
            : req.user;
        if (isProviderBooking && customerId) {
            const client = await User.findById(customerId).select('name email phone role');
            if (!client) {
                return res.status(404).json({ success: false, message: 'Selected client not found' });
            }
            // A provider may only book on behalf of a real client of THEIRS — a
            // customer account that has booked them before. Without this, a provider
            // could attach a confirmed booking to (and read the name + email of) ANY
            // account on the platform, and reserve against a stranger's wallet held
            // with them. First-time in-person clients go through the walk-in path
            // (walkInName), which needs no pre-existing relationship.
            const isMyClient = client.role === 'customer'
                && await Appointment.exists({ customer: customerId, provider: req.user._id });
            if (!isMyClient) {
                return res.status(403).json({ success: false, message: 'You can only book on behalf of an existing client. Use a walk-in for a first-time client.' });
            }
            bookingClient = client;
        }

        // Respect blocks — once either party blocks the other, no booking between them.
        // (Guests are anonymous — no block relationship exists, like walk-ins.)
        if (req.user?.role === 'customer' && svc.provider) {
            const prov = await User.findById(svc.provider).select('blockedUsers');
            const iBlocked = (req.user.blockedUsers || []).map(String).includes(svc.provider.toString());
            const blockedByProvider = (prov?.blockedUsers || []).map(String).includes(req.user._id.toString());
            if (iBlocked || blockedByProvider) {
                return res.status(403).json({ success: false, message: 'Booking is unavailable between you and this provider.' });
            }
        }

        // Customers and guests cannot book a time that has already passed. Providers/
        // admins may back-date (e.g. logging a walk-in that just happened).
        if (isCustomerLike && isPastSlot(appointmentDate, startTime)) {
            return res.status(400).json({ success: false, message: 'That time has already passed. Please pick a later slot.' });
        }

        // Block double-bookings: check provider time overlap (not just same service+time)
        const providerId = svc.provider;

        // Resolve add-ons against the service's OWN catalogue by name, using the
        // stored price/duration — never the values in the request body. Otherwise a
        // client can invent a line item or post a negative price to drive totalPrice
        // (and the wallet reservation) to zero and get a wallet-required service for
        // free, or poison recorded revenue. Unknown add-ons are dropped, not trusted.
        const catalogueAddOns = Array.isArray(svc.addOns) ? svc.addOns : [];
        const resolvedAddOns = (Array.isArray(selectedAddOns) ? selectedAddOns : [])
            .map(sel => catalogueAddOns.find(a => a.name === sel?.name))
            .filter(Boolean)
            .map(a => ({ name: a.name, price: a.price || 0, duration: a.duration || 0 }));
        const addOnPrice = resolvedAddOns.reduce((s, a) => s + a.price, 0);
        const addOnDuration = resolvedAddOns.reduce((s, a) => s + a.duration, 0);

        // A service OPTION (mutually-exclusive variant, e.g. Adults/Students) carries
        // its own price and duration. The client sends the chosen option's NAME; we
        // resolve it against the catalogue so the recorded price is the real variant
        // price — the client priced the booking off the option, but the server used to
        // silently fall back to svc.price, under-charging on every pricier variant.
        const chosenOption = (svc.options || []).find(o => o.name === selectedOptionName) || null;
        const baseServicePrice = chosenOption ? (chosenOption.price || 0) : (svc.price || 0);

        // The booking window must match the service's real length. The client sends
        // startTime/endTime, and every conflict guard below — schedule, blocked time,
        // per-staff overlap — is computed from that window. A shrunk window (a 2h
        // service posted as 15m) double-books the provider invisibly; an inverted
        // window (end < start) makes every half-open overlap test trivially false and
        // slips past all of them. When an option is chosen we validate against ITS
        // length; otherwise any option's length (or the base) is acceptable, plus the
        // server-resolved add-on minutes. Providers keep their override — post-
        // ownership-check they can only affect their own calendar.
        if (isCustomerLike) {
            // validBookingWindow() above guarantees end > start, so this is always
            // positive — the old `if (< 0) += 24*60` cross-midnight fudge is gone
            // along with the windows it used to wave through.
            const bookingDuration = parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime);
            const baseDurations = (chosenOption
                ? [chosenOption.duration]
                : [svc.duration, ...(svc.options || []).map(o => o.duration)]
            ).filter(dur => typeof dur === 'number' && dur > 0);
            if (!baseDurations.length) baseDurations.push(svc.duration || 30);
            const allowed = new Set(baseDurations.map(dur => dur + addOnDuration));
            if (bookingDuration <= 0 || !allowed.has(bookingDuration)) {
                return res.status(400).json({ success: false, message: 'The selected time doesn’t match the service length. Please choose your service and time again.' });
            }
        }

        // Enforce the provider's published availability for customer bookings. Providers
        // may book outside hours (walk-ins/overrides). Only enforced when availability
        // has actually been set, so providers who never published hours aren't blocked.
        let providerSchedule = null; // reused by the recurring-series filter below
        if (isCustomerLike && providerId) {
            const availabilityDoc = await Availability.findOne({ provider: providerId });
            providerSchedule = availabilityDoc?.schedule || null;
            // A shift for a specifically-requested member overrides business hours
            // for that date (see shiftGovernsHours); the per-staff check inside
            // resolveBookingStaff then enforces the shift's own slots and breaks.
            const shiftGoverns = teamMember && await shiftGovernsHours(teamMember, appointmentDate);
            if (providerSchedule && !shiftGoverns) {
                const bookingDuration = parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime);
                if (!isTimeWithinSchedule(providerSchedule, appointmentDate, startTime, bookingDuration)) {
                    return res.status(400).json({ success: false, message: 'Selected time is outside the provider availability schedule' });
                }
            }
        }

        // Per-staff resolution (spec §3.6): validates a requested member
        // (ownership, active, performs the service, staff hours, blocked time,
        // their existing bookings) and resolves "any available" for customer
        // bookings when the business has staff. Zero-staff businesses resolve
        // to null — the legacy provider-level path, unchanged.
        let resolvedTeamMember = teamMember || null;
        if (providerId) {
            const resolution = await resolveBookingStaff({
                svc, providerId, appointmentDate, startTime, endTime,
                // Guests resolve staff exactly like a customer ("any available").
                requestedTeamMember: teamMember || null, requester: req.user || { role: 'customer' },
            });
            if (resolution.error) {
                return res.status(resolution.status).json({ success: false, message: resolution.error });
            }
            resolvedTeamMember = resolution.teamMember;
        }

        // Blocked time is a hard stop for customers and guests. resolveBookingStaff
        // only checks blocks when the business HAS staff (it returns early for a
        // zero-staff business), so without this a solo provider's lunch break or
        // day off could be booked straight over. Providers keep their override —
        // they may deliberately book a walk-in into their own blocked time.
        if (isCustomerLike && providerId) {
            const blocked = await overlapsBlockedTime({
                providerId, appointmentDate, startTime, endTime, teamMember: resolvedTeamMember,
            });
            if (blocked) {
                return res.status(400).json({ success: false, message: BLOCKED_MESSAGE });
            }
        }

        if (providerId) {
            const [newSH, newSM] = startTime.split(':').map(Number);
            const [newEH, newEM] = endTime.split(':').map(Number);
            // Buffer minutes around the new booking are treated as occupied
            const newStart = newSH * 60 + newSM - (svc.bufferBefore || 0);
            const newEnd = newEH * 60 + newEM + (svc.bufferAfter || 0);
            const dayStart = new Date(appointmentDate); dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(appointmentDate); dayEnd.setHours(23, 59, 59, 999);
            // Per-staff conflicts: different team members can be booked concurrently.
            // When a staff member is set, only their bookings count; otherwise the
            // provider's own (unassigned) bookings count. Runs AFTER resolution so
            // it re-checks the resolved member — the race backstop.
            const overlapQuery = {
                provider: providerId,
                appointmentDate: { $gte: dayStart, $lte: dayEnd },
                status: { $nin: ['cancelled'] },
            };
            overlapQuery.teamMember = resolvedTeamMember;
            const existing = await Appointment.find(overlapQuery).select('startTime endTime');
            const hasOverlap = existing.some(a => {
                const [aSH, aSM] = a.startTime.split(':').map(Number);
                const [aEH, aEM] = a.endTime.split(':').map(Number);
                const aStart = aSH * 60 + aSM;
                const aEnd = aEH * 60 + aEM;
                return newStart < aEnd && newEnd > aStart;
            });
            if (hasOverlap) {
                return res.status(400).json({ success: false, message: 'This time slot is already booked. You can join the waiting list instead.' });
            }
        } else {
            // Fallback for services without a provider: check by service+time
            const existingAppointment = await Appointment.findOne({
                service,
                appointmentDate: new Date(appointmentDate),
                startTime,
                status: { $nin: ['cancelled'] },
            });
            if (existingAppointment) {
                return res.status(400).json({ success: false, message: 'This time slot is already booked. You can join the waiting list instead.' });
            }
        }

        const basePrice = baseServicePrice + addOnPrice;

        // Resolve how this booking is paid. When the provider's wallet is on, the
        // client picks wallet or cash (falling back to the provider's default);
        // otherwise it's a plain cash/pay-later booking.
        let walletCfg = null;
        let chosenMethod = 'cash';
        if (svc.provider) {
            const provWallet = await User.findById(svc.provider).select('walletSettings');
            walletCfg = provWallet?.walletSettings || null;
            // A guest has no prepaid wallet — always cash. If the business REQUIRES
            // wallet prepayment, a guest can't satisfy it, so ask them to sign up.
            if (isGuest) {
                if (walletCfg?.enabled && walletCfg.bookingPaymentMode === 'wallet_required') {
                    return res.status(400).json({ success: false, message: 'This business requires prepayment. Please create an account to book.' });
                }
            } else if (walletCfg?.enabled) {
                chosenMethod = (paymentMethod === 'wallet' || paymentMethod === 'cash')
                    ? paymentMethod
                    : (walletCfg.bookingPaymentMode === 'wallet_required' ? 'wallet' : 'cash');
            }
        }

        const baseDoc = {
            customer: bookingClient._id, // null for a guest booking
            service,
            provider: svc.provider || null,
            startTime,
            endTime,
            notes: notes || '',
            selectedAddOns: resolvedAddOns,
            selectedOptionName: chosenOption ? chosenOption.name : null,
            totalPrice: basePrice,
            status: 'confirmed',
            statusHistory: [{ status: 'confirmed', changedBy: req.user?._id || null }],
            // Guest contact (no account) — the manageToken is their access credential.
            guestName: isGuest ? bookingClient.name : null,
            guestEmail: isGuest ? bookingClient.email : null,
            guestPhone: isGuest ? (bookingClient.phone || null) : null,
            // Walk-in name only when the provider didn't pick a registered client.
            walkInName: isProviderBooking && !customerId ? (walkInName?.trim() || null) : null,
            teamMember: resolvedTeamMember,
            paymentMethod: chosenMethod,
            manageToken: randomUUID(),
        };

        let appointment;
        // Dates in a recurring series that had to be skipped (blocked/closed/taken),
        // reported back so the client knows which weeks didn't book.
        let skippedDates = [];

        if (isRecurring && recurrenceType && ['daily', 'weekly', 'monthly'].includes(recurrenceType)) {
            const groupId = randomUUID();
            // Repeat every N units (the "Custom" frequency); defaults to every 1.
            const interval = Math.min(52, Math.max(1, parseInt(recurrenceInterval, 10) || 1));
            const seriesEnd = recurrenceEndDate ? new Date(recurrenceEndDate) : (() => {
                const d = new Date(appointmentDate);
                d.setMonth(d.getMonth() + 3);
                return d;
            })();
            const candidates = [];
            const anchor = new Date(appointmentDate);
            const MAX = 60;
            let step = 0;
            let cur = new Date(anchor);
            while (cur <= seriesEnd && candidates.length < MAX) {
                candidates.push(new Date(cur));
                step += 1;
                cur = occurrenceFromAnchor(anchor, recurrenceType, interval, step);
            }

            // Drop occurrences that land on blocked time, a closed day, or an
            // existing booking — previously every date was inserted unchecked.
            const { kept, skipped } = await filterBookableOccurrences({
                providerId, dates: candidates, startTime, endTime,
                teamMember: resolvedTeamMember, schedule: providerSchedule,
                duration: parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime),
                enforceHoursAndBlocks: isCustomerLike,
            });
            skippedDates = skipped;

            const docs = kept.map(d => ({ ...baseDoc, appointmentDate: new Date(d), isRecurring: true, recurrenceType, recurrenceInterval: interval, recurrenceGroupId: groupId, recurrenceEndDate: seriesEnd, manageToken: randomUUID() }));
            const created = await Appointment.insertMany(docs);
            appointment = created[0];
            await appointment.populate(['service', { path: 'customer', select: 'name email' }]);
        } else {
            appointment = await Appointment.create({ ...baseDoc, appointmentDate: new Date(appointmentDate) });
            await appointment.populate(['service', { path: 'customer', select: 'name email' }]);
        }

        // Close the check-then-insert race: if a conflicting booking was created
        // concurrently (single-node Mongo has no transactions), the later writer —
        // identified by the larger _id, which is time-ordered — rolls itself back so
        // only one booking survives the same slot.
        if (!isRecurring && providerId) {
            const dayStart = new Date(appointmentDate); dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(appointmentDate); dayEnd.setHours(23, 59, 59, 999);
            const sameDay = await Appointment.find({
                provider: providerId,
                appointmentDate: { $gte: dayStart, $lte: dayEnd },
                status: { $nin: ['cancelled'] },
                teamMember: resolvedTeamMember,
                _id: { $ne: appointment._id },
            }).select('startTime endTime _id');
            const [nSH, nSM] = startTime.split(':').map(Number);
            const [nEH, nEM] = endTime.split(':').map(Number);
            const nStart = nSH * 60 + nSM - (svc.bufferBefore || 0);
            const nEnd = nEH * 60 + nEM + (svc.bufferAfter || 0);
            const lostRace = sameDay.some(a => {
                const [aSH, aSM] = a.startTime.split(':').map(Number);
                const [aEH, aEM] = a.endTime.split(':').map(Number);
                const overlaps = nStart < (aEH * 60 + aEM) && nEnd > (aSH * 60 + aSM);
                return overlaps && a._id.toString() < appointment._id.toString();
            });
            if (lostRace) {
                await Appointment.deleteOne({ _id: appointment._id });
                return res.status(400).json({ success: false, message: 'This time slot was just booked. You can join the waiting list instead.' });
            }
        }

        // Wallet reservation: when the booking is paid by wallet, hold the service
        // price from the CLIENT's wallet. The reserve is atomic (spec §12). A client
        // self-booking that can't cover it is rolled back (they can switch to cash or
        // top up); a provider booking on a client's behalf reserves when possible but
        // is never blocked. Cash bookings, walk-ins and recurring series skip this.
        const reservationClientId = req.user?.role === 'customer'
            ? req.user._id
            : (isProviderBooking && customerId ? bookingClient._id : null);
        if (reservationClientId && svc.provider && !isRecurring && walletCfg?.enabled && chosenMethod === 'wallet') {
            try {
                const result = await walletService.reserveFunds({
                    customer: reservationClientId, provider: svc.provider,
                    amount: basePrice, appointmentId: appointment._id, initiatedBy: req.user._id,
                });
                if (!result.ok) {
                    if (req.user?.role === 'customer') {
                        await Appointment.deleteOne({ _id: appointment._id });
                        const avail = result.wallet ? Math.max(0, result.wallet.totalBalance - result.wallet.reservedBalance) : 0;
                        return res.status(400).json({
                            success: false,
                            code: 'INSUFFICIENT_WALLET',
                            message: `Insufficient wallet balance. This service costs N$${basePrice.toFixed(2)} and you have N$${avail.toFixed(2)} available — top up your wallet or choose cash payment instead.`,
                        });
                    }
                    // Provider override: keep the booking even though funds were short.
                } else {
                    createNotification(reservationClientId, `N$${basePrice.toFixed(2)} reserved for ${apptPhrase(svc.name)}`, 'wallet', '/wallet');
                }
            } catch (walletErr) {
                logger.error({ err: walletErr }, 'Wallet reservation failed');
            }
        }

        // Respond immediately — notifications and email run in the background.
        // A recurring series reports any dates it had to skip (blocked, closed or
        // already taken) so the customer isn't silently missing a week.
        res.status(201).json({
            success: true,
            message: skippedDates.length
                ? `Appointment confirmed. ${skippedDates.length} date(s) in the series were unavailable and were skipped.`
                : 'Appointment confirmed',
            data: appointment,
            ...(skippedDates.length ? { skippedDates } : {}),
        });

        // Notify the provider (in-app) and alert admins of the new booking (fire-and-forget)
        setImmediate(async () => {
            try {
                const bookingDate = new Date(appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                // Who the booking is for, in human terms — the registered client, the
                // walk-in's name, or (for a self-booking) the customer themselves.
                const clientLabel = isProviderBooking
                    ? (customerId ? bookingClient.name : (walkInName?.trim() || 'a walk-in client'))
                    : (req.user?.name || bookingClient.name);
                const priceTag = Number.isFinite(basePrice) ? ` (N$${basePrice.toFixed(2)})` : '';
                if (svc.provider) {
                    await createNotification(
                        svc.provider,
                        `🎉 New booking — ${clientLabel} booked ${servicePhrase(svc.name)}${priceTag} on ${bookingDate} at ${startTime}`,
                        'appointment',
                        '/dashboard'
                    );
                }
                // When a provider books an existing client, let that client know.
                if (isProviderBooking && customerId) {
                    await createNotification(
                        bookingClient._id,
                        `✅ You’re booked for ${servicePhrase(svc.name)} with ${req.user.name} on ${bookingDate} at ${startTime}.`,
                        'appointment',
                        '/appointments'
                    );
                }
                await notifyAdmins(
                    `New booking: ${servicePhrase(svc.name)} by ${clientLabel} on ${bookingDate} at ${startTime}`,
                    'system',
                    '/bkplus-command'
                );
            } catch (err) { logger.error({ err }, 'Booking notification failed'); }

            try {
                const dateStr = new Date(appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                const timeStr = `${startTime} – ${endTime}`;
                // Shared helper: emits a real UTC instant. The old inline builder wrote a
                // floating stamp with no zone, which Google reads as UTC — showing a 10:00
                // booking as 12:00 to a CAT (UTC+2) reader.
                const gcalUrl = calendarHelper.googleCalendarUrl({
                    title: svc.name, appointmentDate, startTime, endTime,
                    details: 'Booked via Bookplus',
                });

                // Extras for the confirmation email: venue, manage link, directions
                const providerDoc = svc.provider ? await User.findById(svc.provider).select('name businessProfile') : null;
                const address = providerDoc?.businessProfile?.address || '';
                const clientBase = primaryOrigin() || '';
                const extras = {
                    price: basePrice,
                    bookingRef: String(appointment._id).slice(-8).toUpperCase(),
                    manageUrl: appointment.manageToken ? `${clientBase}/manage/${appointment.manageToken}` : undefined,
                    directionsUrl: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : undefined,
                    venue: providerDoc?.name || undefined,
                    address: address || undefined,
                    // Downloadable .ics so the booking drops straight into any calendar app.
                    ics: calendarHelper.buildIcs({
                        uid: `${appointment._id}@bookplus`, title: svc.name,
                        appointmentDate, startTime, endTime,
                        description: 'Booked via Bookplus', location: address || undefined, status: 'CONFIRMED',
                    }),
                };
                // Send the confirmation to whoever the booking is for: the registered
                // client when a provider booked on their behalf, otherwise the requester.
                await sendAppointmentConfirmed(
                    bookingClient.email,
                    bookingClient.name,
                    svc.name,
                    dateStr,
                    timeStr,
                    gcalUrl,
                    extras
                );
            } catch (err) { logger.error({ err }, 'Booking confirmation email failed'); }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Provider-built multi-service booking: several of the provider's OWN services
// performed back-to-back within a single appointment (the "Add service" flow).
// Provider-only + provider-owned services, so it inherits the provider's override
// of schedule/past/blocked time — it just needs ownership, a valid client, a
// same-staff overlap check, and wallet handling for the summed total. The
// single-service createAppointment above is deliberately left untouched.
exports.createMultiServiceAppointment = async (req, res) => {
    try {
        if (req.user?.role !== 'provider') {
            return res.status(403).json({ success: false, message: 'Only providers can build a multi-service booking here.' });
        }
        const { appointmentDate, startTime, services: reqServices, notes, customerId, walkInName, teamMember, paymentMethod } = req.body;
        if (!appointmentDate || !startTime || !Array.isArray(reqServices) || reqServices.length === 0) {
            return res.status(400).json({ success: false, message: 'Provide a date, start time and at least one service.' });
        }
        if (reqServices.length > 20) {
            return res.status(400).json({ success: false, message: 'Too many services in one appointment.' });
        }
        const startMin = parseTimeToMinutes(startTime);
        if (!(startMin >= 0)) return res.status(400).json({ success: false, message: 'Invalid start time.' });

        // Load + validate every service belongs to this provider. Price/duration/name
        // come from the catalogue, never the request body, and each service is laid
        // out back-to-back from startTime.
        const providerId = req.user._id;
        const built = [];
        let cursor = startMin;
        for (const item of reqServices) {
            const svc = await Service.findById(item?.serviceId);
            if (!svc) return res.status(404).json({ success: false, message: 'One of the selected services was not found.' });
            if (String(svc.provider) !== String(providerId)) {
                return res.status(403).json({ success: false, message: 'You can only add your own services.' });
            }
            const duration = (typeof svc.duration === 'number' && svc.duration > 0) ? svc.duration : 30;
            built.push({
                service: svc._id,
                name: svc.name,
                price: svc.price || 0,
                duration,
                startTime: minutesToTime(cursor),
                endTime: minutesToTime(cursor + duration),
                teamMember: item?.teamMember || teamMember || null,
            });
            cursor += duration;
        }

        // Per-segment staff must be on THIS provider's active roster. item.teamMember
        // was previously stored verbatim, so any ObjectId — including another
        // business's member — could be written onto the booking.
        const segMembers = [...new Set(built.map(b => b.teamMember).filter(Boolean).map(String))];
        if (segMembers.length) {
            const onRoster = await TeamMember.find({ _id: { $in: segMembers }, provider: providerId, isActive: true }).select('_id');
            if (onRoster.length !== segMembers.length) {
                return res.status(400).json({ success: false, message: 'One of the selected staff members is not on your team.' });
            }
        }

        const spanStart = startTime;
        const spanEnd = minutesToTime(cursor);
        // minutesToTime wraps into a 24h day, so a stack of services running past
        // midnight silently formats as an earlier time — the same invisible-booking
        // shape guarded against on the single-service path.
        if (!validBookingWindow(spanStart, spanEnd)) {
            return res.status(400).json({ success: false, message: 'These services would run past midnight. Pick an earlier start.' });
        }
        const totalPrice = built.reduce((s, x) => s + x.price, 0);
        const primaryTeamMember = built[0].teamMember || teamMember || null;

        // Resolve the client: an existing client of THIS provider, or a walk-in
        // (matches the ownership rule the single-service create enforces).
        let bookingClient = { _id: null, name: walkInName?.trim() || null };
        if (customerId) {
            const client = await User.findById(customerId).select('name email phone role');
            if (!client) return res.status(404).json({ success: false, message: 'Selected client not found' });
            const isMyClient = client.role === 'customer' && await Appointment.exists({ customer: customerId, provider: providerId });
            if (!isMyClient) {
                return res.status(403).json({ success: false, message: 'You can only book on behalf of an existing client. Use a walk-in for a first-time client.' });
            }
            bookingClient = client;
        } else if (!bookingClient.name) {
            return res.status(400).json({ success: false, message: 'Choose a client or enter a walk-in name.' });
        }

        // Overlap check, PER staff member and per segment.
        //
        // This used to test the whole span against `primaryTeamMember` only — the
        // first service's member. A stack like A(10:00–11:00, Alice) + B(11:00–12:00,
        // Bob) was therefore only ever checked against Alice, so Bob could be booked
        // straight over an existing 11:00 appointment of his. Each segment now checks
        // its own member over its own minutes; different staff may still run
        // concurrently, which is the point of the multi-service flow.
        const dayStart = new Date(appointmentDate); dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(appointmentDate); dayEnd.setHours(23, 59, 59, 999);
        const sameDay = await Appointment.find({
            provider: providerId,
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            status: { $nin: ['cancelled'] },
        }).select('startTime endTime teamMember');
        for (const seg of built) {
            const segMember = seg.teamMember || teamMember || null;
            const segStart = parseTimeToMinutes(seg.startTime);
            const segEnd = parseTimeToMinutes(seg.endTime);
            const clash = sameDay.some(a => (
                String(a.teamMember || '') === String(segMember || '')
                && segStart < parseTimeToMinutes(a.endTime)
                && segEnd > parseTimeToMinutes(a.startTime)
            ));
            if (clash) {
                return res.status(400).json({ success: false, message: 'That time overlaps an existing booking for one of the selected staff members.' });
            }
        }

        // Payment: reuse the provider's wallet config. Provider bookings are never
        // blocked on insufficient funds — reserve the summed total when possible.
        const provWallet = await User.findById(providerId).select('walletSettings');
        const walletCfg = provWallet?.walletSettings || null;
        let chosenMethod = 'cash';
        if (walletCfg?.enabled && customerId) {
            chosenMethod = (paymentMethod === 'wallet' || paymentMethod === 'cash')
                ? paymentMethod
                : (walletCfg.bookingPaymentMode === 'wallet_required' ? 'wallet' : 'cash');
        }

        const appointment = await Appointment.create({
            customer: bookingClient._id,
            service: built[0].service, // back-compat: top-level service = the first one
            provider: providerId,
            appointmentDate: new Date(appointmentDate),
            startTime: spanStart,
            endTime: spanEnd,
            notes: notes || '',
            services: built,
            totalPrice,
            status: 'confirmed',
            statusHistory: [{ status: 'confirmed', changedBy: req.user._id }],
            walkInName: customerId ? null : bookingClient.name,
            teamMember: primaryTeamMember,
            paymentMethod: chosenMethod,
            manageToken: randomUUID(),
        });
        await appointment.populate(['service', { path: 'customer', select: 'name email' }, { path: 'services.service', select: 'name price duration' }]);

        if (customerId && walletCfg?.enabled && chosenMethod === 'wallet' && totalPrice > 0) {
            try {
                const result = await walletService.reserveFunds({
                    customer: bookingClient._id, provider: providerId,
                    amount: totalPrice, appointmentId: appointment._id, initiatedBy: req.user._id,
                });
                if (result.ok) createNotification(bookingClient._id, `N$${totalPrice.toFixed(2)} reserved for your appointment`, 'wallet', '/wallet');
            } catch (walletErr) {
                logger.error({ err: walletErr }, 'Multi-service wallet reservation failed');
            }
        }

        res.status(201).json({ success: true, message: 'Appointment booked', data: appointment });

        setImmediate(async () => {
            try {
                const bookingDate = new Date(appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const label = customerId ? bookingClient.name : (bookingClient.name || 'a walk-in client');
                const svcNames = built.map(b => b.name).join(', ');
                await createNotification(providerId, `🎉 New booking — ${label}: ${svcNames} (N$${totalPrice.toFixed(2)}) on ${bookingDate} at ${spanStart}`, 'appointment', '/dashboard');
                if (customerId) {
                    await createNotification(bookingClient._id, `✅ You’re booked for ${svcNames} with ${req.user.name} on ${bookingDate} at ${spanStart}.`, 'appointment', '/appointments');
                }
            } catch (err) { logger.error({ err }, 'Multi-service booking notification failed'); }
        });
    } catch (error) {
        logger.error({ err: error }, 'createMultiServiceAppointment failed');
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findById(req.params.id).populate('service');
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        // Only the owning customer or an admin may update. Guest appointments have
        // no owner account, so only an admin can touch them here.
        if ((!appointment.customer || appointment.customer.toString() !== req.user._id.toString()) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized to update this appointment' });
        }
        const { appointmentDate, startTime, endTime, status, notes } = req.body;

        const newDate = appointmentDate || appointment.appointmentDate;
        const newStart = startTime || appointment.startTime;
        let newEnd = endTime || appointment.endTime;
        // If the start moved but no explicit end was given, recompute end from the service duration.
        if (startTime && !endTime) {
            const dur = appointment.service?.duration
                || (parseTimeToMinutes(appointment.endTime) - parseTimeToMinutes(appointment.startTime))
                || 30;
            const tm = parseTimeToMinutes(startTime) + dur;
            newEnd = `${String(Math.floor(tm / 60) % 24).padStart(2, '0')}:${String(tm % 60).padStart(2, '0')}`;
        }

        const dateChanged = appointmentDate && new Date(appointmentDate).getTime() !== new Date(appointment.appointmentDate).getTime();
        const timingChanged = dateChanged || (startTime && startTime !== appointment.startTime) || (endTime && endTime !== appointment.endTime);

        // Validate any timing change so an edit can never double-book or fall outside hours.
        if (timingChanged && appointment.status !== 'cancelled') {
            const providerId = appointment.provider || appointment.service?.provider;
            if (providerId) {
                const duration = parseTimeToMinutes(newEnd) - parseTimeToMinutes(newStart);
                if (duration <= 0) {
                    return res.status(400).json({ success: false, message: 'End time must be after the start time' });
                }
                const schedule = await getProviderSchedule(providerId);
                if (!isTimeWithinSchedule(schedule, newDate, newStart, duration)) {
                    return res.status(400).json({ success: false, message: 'Selected time is outside the availability schedule' });
                }
                if (await hasConflictingAppointment(providerId, newDate, newStart, newEnd, appointment._id, conflictScope(appointment))) {
                    return res.status(400).json({ success: false, message: 'This time slot is already booked' });
                }
            }
        }

        appointment.appointmentDate = appointmentDate ? new Date(appointmentDate) : appointment.appointmentDate;
        appointment.startTime = newStart;
        appointment.endTime = newEnd;
        appointment.status = status || appointment.status;
        appointment.notes = notes !== undefined ? notes : appointment.notes;
        await appointment.save();
        res.status(200).json({ success: true, message: 'Appointment updated successfully', data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.cancelAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findById(req.params.id)
            .populate('customer', 'name email')
            .populate('service', 'name');
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        // Guest appointments (customer null) have no owner account — only an admin
        // can cancel them here; guests use the /manage/:token flow.
        if ((!appointment.customer || appointment.customer._id.toString() !== req.user._id.toString()) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized to cancel this appointment' });
        }
        if (req.user.role !== 'admin') {
            // A booking whose start time has passed is history — it can be
            // completed or disputed with the business, but not cancelled.
            if (isPastSlot(appointment.appointmentDate, appointment.startTime)) {
                return res.status(400).json({ success: false, message: 'This appointment has already taken place and can no longer be cancelled.' });
            }
            // Customers must respect the provider's notice window; admins are exempt.
            if (['pending', 'confirmed'].includes(appointment.status)) {
                const providerId = appointment.provider || appointment.service?.provider;
                const policy = await checkCancellationWindow(providerId, appointment.appointmentDate, appointment.startTime);
                if (!policy.allowed) {
                    return res.status(400).json({ success: false, message: policy.message });
                }
            }
        }
        appointment.status = 'cancelled';
        appointment.cancellationReason = req.body.cancellationReason || '';
        appointment.statusHistory.push({ status: 'cancelled', changedBy: req.user._id });
        await appointment.save();

        // Release any held wallet funds back to available (idempotent; spec §6).
        try {
            const r = await walletService.releaseReservation({ appointmentId: appointment._id, resolvedBy: req.user._id });
            if (r.released > 0) createNotification(appointment.customer._id, `N$${r.released.toFixed(2)} released back to your wallet`, 'wallet', '/wallet');
        } catch (walletErr) {
            logger.error({ err: walletErr }, 'Wallet release on cancel failed');
        }

        // Tell the BUSINESS their client cancelled. Without this the slot silently
        // vanished from the calendar with no explanation — the owner only found out
        // by noticing the gap. createNotification also fires a web push.
        try {
            const cancelProviderId = appointment.provider || appointment.service?.provider;
            if (cancelProviderId) {
                const who = appointment.walkInName || appointment.guestName || appointment.customer?.name || 'A client';
                const when = new Date(appointment.appointmentDate)
                    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                await createNotification(
                    cancelProviderId,
                    `❌ Cancelled — ${who} cancelled ${apptPhrase(appointment.service?.name)} on ${when} at ${appointment.startTime}. The slot is free again.`,
                    'appointment',
                    '/dashboard'
                );
            }
        } catch (err) { logger.error({ err }, 'Provider cancellation notification failed'); }

        const { promoteFromWaitingList } = require('../utils/waitingListHelper');
        await promoteFromWaitingList(
            appointment.service._id,
            appointment.appointmentDate,
            appointment.startTime,
            appointment.endTime
        );

        // Send cancellation email
        try {
            const date = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            const cc = clientContact(appointment);
            if (cc.email) {
                await sendAppointmentCancelled(cc.email, cc.name, appointment.service.name, date);
            }
        } catch (emailErr) {
            logger.error({ err: emailErr }, 'Cancel email failed');
        }

        res.status(200).json({ success: true, message: 'Appointment cancelled successfully', data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * DELETE /appointments/:id/series
 * Provider cancels all or future occurrences of a recurring series.
 * deleteMode: 'this' | 'thisAndFuture' | 'all'
 */
exports.cancelAppointmentSeries = async (req, res) => {
    try {
        const appt = await Appointment.findById(req.params.id);
        if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });
        if (!appt.recurrenceGroupId) return res.status(400).json({ success: false, message: 'Not a recurring appointment' });
        if (appt.provider?.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const { deleteMode = 'this' } = req.body;
        let filter = { recurrenceGroupId: appt.recurrenceGroupId };

        if (deleteMode === 'this') {
            filter = { _id: appt._id };
        } else if (deleteMode === 'thisAndFuture') {
            filter = { recurrenceGroupId: appt.recurrenceGroupId, appointmentDate: { $gte: appt.appointmentDate } };
        }
        // 'all' uses the base filter (entire group)

        // Only ever cancel occurrences that are still live. Without this,
        // deleteMode:'all' rewrote finished history: past occurrences already marked
        // completed were flipped to cancelled, which silently removed them from
        // earnings (those sum completed bookings) and from the client's visit record.
        // Cancelling a series should end what is still to come, not un-happen what
        // already did.
        filter.status = { $in: ['pending', 'confirmed'] };

        const result = await Appointment.updateMany(filter, { $set: { status: 'cancelled', cancellationReason: 'Recurring series cancelled' } });
        res.status(200).json({ success: true, message: 'Series cancelled', data: { cancelled: result.modifiedCount ?? 0 } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * GET /appointments/history
 * Provider: returns past (completed/cancelled) appointments sorted newest first.
 */
exports.getAppointmentHistory = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { status } = req.query;
        const query = { provider: req.user._id };
        if (status) {
            query.status = status;
        } else {
            // "History" = finished appointments (completed / cancelled / no-show) OR
            // anything already in the past, regardless of status.
            query.$or = [
                { status: { $in: ['completed', 'cancelled', 'no-show'] } },
                { appointmentDate: { $lt: today } },
            ];
        }
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const skip = (page - 1) * limit;

        const [appointments, total] = await Promise.all([
            Appointment.find(query)
                .populate('customer', 'name email phone avatar')
                .populate('service', 'name price duration')
                .sort({ appointmentDate: -1 })
                .skip(skip)
                .limit(limit),
            Appointment.countDocuments(query),
        ]);
        res.status(200).json({ success: true, count: appointments.length, total, data: appointments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateAppointmentStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const appointment = await Appointment.findById(req.params.id)
            .populate('customer', 'name email')
            .populate('service', 'name provider');
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        // Authorize against the appointment's provider, falling back to the service's
        // provider for older waiting-list promotions that were created without one.
        const ownerId = appointment.provider?.toString() || appointment.service?.provider?.toString();
        if (req.user.role !== 'admin' && ownerId !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        // Self-heal: backfill a missing provider so the booking shows on the calendar.
        if (!appointment.provider && appointment.service?.provider) {
            appointment.provider = appointment.service.provider;
        }
        // Idempotent: if the status is already what was requested, do nothing. This stops
        // repeat "Complete" clicks (or a client re-fire) from stacking duplicate
        // notifications, emails and status-history entries for the same appointment.
        if (appointment.status === status) {
            return res.status(200).json({ success: true, data: appointment });
        }
        // Reviving a cancelled booking (cancelled → confirmed/pending) drops it back
        // into a slot the system already treated as free — and likely re-sold, since
        // cancellation triggers waiting-list promotion below. Re-run the same conflict
        // and blocked-time guards a fresh booking faces, so a revive can't silently
        // double-book the provider.
        if (appointment.status === 'cancelled' && ['confirmed', 'pending'].includes(status)) {
            const revProviderId = appointment.provider || appointment.service?.provider;
            if (revProviderId) {
                const conflict = await hasConflictingAppointment(
                    revProviderId, appointment.appointmentDate, appointment.startTime, appointment.endTime, appointment._id, conflictScope(appointment),
                );
                if (conflict) {
                    return res.status(400).json({ success: false, message: 'That slot has since been booked, so this cancelled appointment can’t be reinstated.' });
                }
                if (await overlapsBlockedTime({
                    providerId: revProviderId, appointmentDate: appointment.appointmentDate,
                    startTime: appointment.startTime, endTime: appointment.endTime,
                    teamMember: appointment.teamMember || null,
                })) {
                    return res.status(400).json({ success: false, message: 'That time is now blocked, so this cancelled appointment can’t be reinstated.' });
                }
            }
        }
        appointment.status = status;
        appointment.statusHistory.push({ status, changedBy: req.user._id });
        await appointment.save();

        // Wallet money movement on status change — idempotent, and a no-op when the
        // booking carried no reservation. Completing turns the hold into a permanent
        // deduction (spec §5); cancelling releases it back to available (spec §6).
        try {
            if (status === 'completed') {
                const r = await walletService.deductForCompletion({ appointmentId: appointment._id, resolvedBy: req.user._id });
                if (r.deducted > 0) createNotification(appointment.customer._id, `N$${r.deducted.toFixed(2)} deducted from your wallet for ${apptPhrase(appointment.service?.name)}`, 'wallet', '/wallet');
            } else if (status === 'cancelled') {
                const r = await walletService.releaseReservation({ appointmentId: appointment._id, resolvedBy: req.user._id });
                if (r.released > 0) createNotification(appointment.customer._id, `N$${r.released.toFixed(2)} released back to your wallet`, 'wallet', '/wallet');
            }
        } catch (walletErr) {
            logger.error({ err: walletErr }, 'Wallet update on status change failed');
        }

        // If cancelling via status update, promote waiting list just like direct cancel
        if (status === 'cancelled') {
            const { promoteFromWaitingList } = require('../utils/waitingListHelper');
            await promoteFromWaitingList(
                appointment.service._id,
                appointment.appointmentDate,
                appointment.startTime,
                appointment.endTime
            );
        }

        const messages = {
            confirmed: `${ApptPhrase(appointment.service?.name)} has been confirmed.`,
            completed: `${ApptPhrase(appointment.service?.name)} has been completed — leave a review!`,
            cancelled: `${ApptPhrase(appointment.service?.name)} has been cancelled.`,
            'no-show': `You missed ${apptPhrase(appointment.service?.name)}. Contact your provider to rebook.`,
        };
        // In-app notifications only reach registered accounts (guests have none).
        if (messages[status] && appointment.customer?._id) {
            await createNotification(appointment.customer._id, messages[status], 'appointment', '/appointments');
        }

        // Send email notification (registered customer or guest).
        try {
            const cc = clientContact(appointment);
            const customerEmail = cc.email;
            const customerName = cc.name;
            const serviceName = appointment.service?.name;
            if (customerEmail) {
            const date = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            const time = `${appointment.startTime} – ${appointment.endTime}`;

            if (status === 'confirmed') {
                // Shared helper (real UTC instant) — see the note on the booking path.
                const gcalUrl = calendarHelper.googleCalendarUrl({
                    title: serviceName,
                    appointmentDate: appointment.appointmentDate,
                    startTime: appointment.startTime || '09:00',
                    endTime: appointment.endTime || '10:00',
                    details: 'Booked via Bookplus',
                });
                await sendAppointmentConfirmed(customerEmail, customerName, serviceName, date, time, gcalUrl);
            } else if (status === 'completed') {
                await sendAppointmentCompleted(customerEmail, customerName, serviceName);
                // Send rebooking prompt
                try {
                    const providerId = appointment.provider;
                    const providerDoc = providerId ? await require('../models/User').findById(providerId).select('name') : null;
                    await sendRebookingPrompt(customerEmail, customerName, serviceName, providerDoc?.name || 'your provider', providerId);
                } catch (_) { /* non-critical */ }
            } else if (status === 'cancelled') {
                await sendAppointmentCancelled(customerEmail, customerName, serviceName, date);
            }
            } // end if (customerEmail)
        } catch (emailErr) {
            logger.error({ err: emailErr }, 'Email notification failed');
        }

        res.status(200).json({ success: true, data: appointment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.providerRescheduleAppointment = async (req, res) => {
    try {
        const { appointmentDate, startTime, endTime: requestedEndTime } = req.body;
        if (!appointmentDate || !startTime) {
            return res.status(400).json({ success: false, message: 'appointmentDate and startTime are required' });
        }
        const appointment = await Appointment.findById(req.params.id).populate('service');
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        // Null-safe: older waiting-list promotions can have provider unset, so fall
        // back to the service's provider rather than dereferencing null (which 500'd).
        const ownerId = appointment.provider?.toString() || appointment.service?.provider?.toString();
        if (ownerId !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        if (!['pending', 'confirmed'].includes(appointment.status)) {
            return res.status(400).json({ success: false, message: 'Cannot reschedule a cancelled or completed appointment' });
        }

        const [hours, minutes] = startTime.split(':').map(Number);
        const startMinutes = hours * 60 + minutes;
        // A drag (move) recomputes end from the service duration; a resize sends an
        // explicit endTime to change the appointment's duration.
        let endTime, duration;
        if (requestedEndTime && /^\d{2}:\d{2}$/.test(requestedEndTime)) {
            const [eh, em] = requestedEndTime.split(':').map(Number);
            const endMinutes = eh * 60 + em;
            if (endMinutes <= startMinutes) {
                return res.status(400).json({ success: false, message: 'End time must be after the start time' });
            }
            duration = endMinutes - startMinutes;
            endTime = requestedEndTime;
        } else {
            duration = appointment.service?.duration || 30;
            const totalMinutes = startMinutes + duration;
            const endHours = Math.floor(totalMinutes / 60) % 24;
            const endMins = totalMinutes % 60;
            endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
        }

        if (!validBookingWindow(startTime, endTime)) {
            return res.status(400).json({ success: false, message: 'That time would run past midnight. Pick an earlier start.' });
        }

        const providerId = appointment.provider;
        const schedule = await getProviderSchedule(providerId);
        if (!isTimeWithinSchedule(schedule, appointmentDate, startTime, duration)) {
            return res.status(400).json({ success: false, message: 'Selected time is outside your availability schedule' });
        }

        const conflict = await hasConflictingAppointment(providerId, appointmentDate, startTime, endTime, appointment._id, conflictScope(appointment));
        if (conflict) {
            return res.status(400).json({ success: false, message: 'This time slot is already booked' });
        }

        // Keep the old slot so the write can be undone if it lost a race.
        const previousSlot = { appointmentDate: appointment.appointmentDate, startTime: appointment.startTime, endTime: appointment.endTime };
        appointment.appointmentDate = new Date(appointmentDate);
        appointment.startTime = startTime;
        appointment.endTime = endTime;
        await appointment.save();
        if (await revertRescheduleIfRaced(appointment, previousSlot)) {
            return res.status(409).json({ success: false, message: 'That time was just taken. Please pick another.' });
        }
        res.status(200).json({ success: true, data: appointment });

        // Tell the client their provider moved the appointment (previously silent).
        setImmediate(async () => {
            try {
                const customer = appointment.customer ? await User.findById(appointment.customer).select('name email') : null;
                if (!customer) return; // walk-in / no account — nothing to notify
                const dateStr = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                await createNotification(customer._id, `${ApptPhrase(appointment.service?.name)} has been moved to ${dateStr} at ${startTime}.`, 'appointment', '/appointments');
                if (customer.email) {
                    const providerDoc = await User.findById(appointment.provider).select('name businessProfile');
                    const location = providerDoc?.businessProfile?.address || undefined;
                    const { gcalUrl, ics } = calendarHelper.appointmentCalendar(appointment, { description: 'Booked via Bookplus', location, status: 'CONFIRMED', sequence: 1 });
                    const manageUrl = appointment.manageToken && primaryOrigin() ? `${primaryOrigin()}/manage/${appointment.manageToken}` : undefined;
                    await sendAppointmentRescheduledClient(customer.email, customer.name, appointment.service?.name, dateStr, `${startTime} – ${endTime}`, { gcalUrl, ics, manageUrl });
                }
            } catch (err) { logger.error({ err }, 'Provider reschedule notification failed'); }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * Move several of the provider's own bookings in one decision.
 *
 * Dragging a booking onto an occupied slot offers to reschedule the occupant
 * too, and a push can ripple through a whole afternoon. That is ONE decision by
 * the provider, so it has to land as one unit: three separate calls to
 * /provider-reschedule can half-succeed and leave the day genuinely
 * double-booked — worse than the clash being resolved.
 *
 * There is no `session.startTransaction()` to lean on: the deployment runs a
 * standalone mongod (see docker-compose.yml), and Mongo only offers multi-document
 * transactions on a replica set. So atomicity is built rather than borrowed:
 *
 *   1. VALIDATE the whole finished arrangement in memory, before a single write.
 *      Nothing is touched until every move is known to be legal, which is what
 *      keeps the failure window small.
 *   2. WRITE each move conditionally, matching on the slot we believe it still
 *      occupies. A booking someone else moved underneath us fails to match, and
 *      that is the race guard `revertRescheduleIfRaced` gives the single-move path.
 *   3. RE-CHECK against the database once the writes are durable, to catch a
 *      booking created concurrently by someone else.
 *   4. COMPENSATE on any failure — put every already-written booking back where
 *      it was, and report the whole batch as failed.
 *
 * Step 4 is the honest limit: a crash between writes could strand the day
 * half-moved. Converting mongod to a single-node replica set would let steps
 * 2–4 collapse into a real transaction, and is the right follow-up if this
 * proves load-bearing.
 */
const MAX_BATCH_MOVES = 25;

exports.providerBatchReschedule = async (req, res) => {
    try {
        const { moves, allowOutsideHours = false } = req.body || {};

        if (!Array.isArray(moves) || moves.length === 0) {
            return res.status(400).json({ success: false, message: 'moves must be a non-empty array' });
        }
        if (moves.length > MAX_BATCH_MOVES) {
            return res.status(400).json({ success: false, message: `Cannot move more than ${MAX_BATCH_MOVES} bookings at once` });
        }
        for (const m of moves) {
            if (!m || !m.id || !m.appointmentDate || !m.startTime) {
                return res.status(400).json({ success: false, message: 'Each move needs id, appointmentDate and startTime' });
            }
        }
        const ids = moves.map((m) => String(m.id));
        if (new Set(ids).size !== ids.length) {
            return res.status(400).json({ success: false, message: 'The same booking appears twice in one batch' });
        }

        const appointments = await Appointment.find({ _id: { $in: ids } }).populate('service');
        if (appointments.length !== ids.length) {
            return res.status(404).json({ success: false, message: 'One of those bookings no longer exists' });
        }

        const byId = new Map(appointments.map((a) => [a._id.toString(), a]));
        const me = req.user._id.toString();

        // Every booking in the batch must be this provider's, and still movable.
        for (const a of appointments) {
            const ownerId = a.provider?.toString() || a.service?.provider?.toString();
            if (ownerId !== me) {
                return res.status(403).json({ success: false, message: 'Not authorized' });
            }
            if (!['pending', 'confirmed'].includes(a.status)) {
                return res.status(400).json({ success: false, message: 'Cannot reschedule a cancelled or completed appointment' });
            }
        }

        const providerId = appointments[0].provider || appointments[0].service?.provider;
        // One batch, one provider — mixing providers would make the conflict scope
        // meaningless, and there is no UI that can produce it.
        if (appointments.some((a) => String(a.provider || a.service?.provider) !== String(providerId))) {
            return res.status(400).json({ success: false, message: 'All bookings in a batch must belong to one provider' });
        }

        // ── 1. Work out, and check, the whole finished arrangement ──────────
        const schedule = await getProviderSchedule(providerId);
        const planned = [];

        for (const m of moves) {
            const appt = byId.get(String(m.id));
            const startMinutes = parseTimeToMinutes(m.startTime);
            if (!Number.isFinite(startMinutes)) {
                return res.status(400).json({ success: false, message: 'Invalid start time' });
            }

            // A move keeps the booking's length; a resize sends an explicit endTime.
            let endTime, duration;
            if (m.endTime && /^\d{2}:\d{2}$/.test(m.endTime)) {
                const endMinutes = parseTimeToMinutes(m.endTime);
                if (!(endMinutes > startMinutes)) {
                    return res.status(400).json({ success: false, message: 'End time must be after the start time' });
                }
                duration = endMinutes - startMinutes;
                endTime = m.endTime;
            } else {
                duration = Math.max(15, parseTimeToMinutes(appt.endTime) - parseTimeToMinutes(appt.startTime))
                    || appt.service?.duration || 30;
                endTime = minutesToTime(startMinutes + duration);
            }

            if (!validBookingWindow(m.startTime, endTime)) {
                return res.status(400).json({ success: false, message: 'That time would run past midnight. Pick an earlier start.' });
            }
            // Providers may place work outside their published hours; the drag
            // surface sets this on every move, because dragging a booking on your
            // own calendar IS the deliberate act — matching what the existing
            // single-booking provider path already allows. The flag stays because
            // the default is strict and any future caller must opt in explicitly.
            if (!allowOutsideHours && !isTimeWithinSchedule(schedule, m.appointmentDate, m.startTime, duration)) {
                return res.status(400).json({ success: false, message: 'Selected time is outside your availability schedule' });
            }

            // The client may send the slot it BELIEVED this booking held. Guard on
            // that rather than on what we read just now: otherwise a plan built
            // before someone else moved the booking still applies cleanly, and
            // that person's newly agreed time is silently overwritten. Absent, we
            // fall back to the current slot (the drag UI always sends it).
            const expected = m.expect && /^\d{2}:\d{2}$/.test(m.expect.startTime || '')
                ? {
                    appointmentDate: new Date(m.expect.appointmentDate),
                    startTime: m.expect.startTime,
                    endTime: m.expect.endTime,
                }
                : null;

            planned.push({
                appt,
                id: appt._id.toString(),
                appointmentDate: new Date(m.appointmentDate),
                dateKey: toDateKey(m.appointmentDate),
                startTime: m.startTime,
                endTime,
                scope: conflictScope(appt),
                previous: {
                    appointmentDate: appt.appointmentDate,
                    startTime: appt.startTime,
                    endTime: appt.endTime,
                },
                // What the write is allowed to match on.
                guard: expected || {
                    appointmentDate: appt.appointmentDate,
                    startTime: appt.startTime,
                    endTime: appt.endTime,
                },
            });
        }

        // Batch against itself: two moves in one decision must not collide either.
        for (let i = 0; i < planned.length; i += 1) {
            for (let j = i + 1; j < planned.length; j += 1) {
                const a = planned[i], b = planned[j];
                if (a.dateKey !== b.dateKey) continue;
                if (String(a.scope.teamMember || '') !== String(b.scope.teamMember || '')) continue;
                const aStart = parseTimeToMinutes(a.startTime) - (a.scope.bufferBefore || 0);
                const aEnd = parseTimeToMinutes(a.endTime) + (a.scope.bufferAfter || 0);
                if (timesOverlap(aStart, aEnd, parseTimeToMinutes(b.startTime), parseTimeToMinutes(b.endTime))) {
                    return res.status(400).json({ success: false, message: 'Those moves overlap each other' });
                }
            }
        }

        // Batch against everything it is NOT moving.
        for (const p of planned) {
            const clash = await hasConflictingAppointment(
                providerId, p.appointmentDate, p.startTime, p.endTime, ids, p.scope,
            );
            if (clash) {
                return res.status(409).json({
                    success: false,
                    message: `${p.appt.service?.name || 'That booking'} still clashes with something at ${p.startTime}. Refresh and try again.`,
                });
            }
        }

        // ── 2. Apply, each write guarded on the slot we think it still holds ─
        const written = [];
        // Compensation. Guarded on the slot we wrote, so a booking someone else
        // has since moved is left alone rather than yanked back. The old slot is
        // re-checked too: while this batch held it open the public booking page
        // may have SOLD it, and restoring blindly would create the double-booking
        // the endpoint exists to prevent.
        let rollbackClean = true;
        const undoAll = async () => {
            for (const p of written) {
                try {
                    const clash = await hasConflictingAppointment(
                        providerId, p.previous.appointmentDate, p.previous.startTime, p.previous.endTime,
                        [p.id], p.scope,
                    );
                    if (clash) {
                        rollbackClean = false;
                        logger.error({ appointmentId: p.id }, 'Batch rollback: old slot was resold, leaving booking at its new time');
                        continue;
                    }
                    const restored = await Appointment.updateOne(
                        { _id: p.id, appointmentDate: p.appointmentDate, startTime: p.startTime, endTime: p.endTime },
                        { $set: p.previous },
                    );
                    if (!restored.matchedCount) rollbackClean = false;
                } catch (err) {
                    rollbackClean = false;
                    logger.error({ err, appointmentId: p.id }, 'Batch reschedule rollback failed — day may be inconsistent');
                }
            }
        };
        // A thrown error mid-write used to skip compensation entirely and return
        // 500, stranding the day half-moved while the process was perfectly able
        // to put it back.
        const failed = async (status, message) => {
            await undoAll();
            return res.status(status).json({
                success: false,
                message: rollbackClean ? message : `${message} Some bookings could not be put back — please refresh and check the day.`,
            });
        };

        try {
        for (const p of planned) {
            const updated = await Appointment.findOneAndUpdate(
                {
                    _id: p.id,
                    appointmentDate: p.guard.appointmentDate,
                    startTime: p.guard.startTime,
                    endTime: p.guard.endTime,
                    status: { $in: ['pending', 'confirmed'] },
                },
                // findOneAndUpdate skips document middleware, so the model's
                // pre('save') hook that clears these on a time change never runs.
                // Without this a booking dragged three weeks out keeps
                // reminderSent24h=true and the customer is never reminded.
                { $set: {
                    appointmentDate: p.appointmentDate, startTime: p.startTime, endTime: p.endTime,
                    reminderSent24h: false, reminderSent5h: false, reminderSent1h: false,
                } },
                { new: true },
            );
            if (!updated) {
                return failed(409, 'One of those bookings changed while you were moving it. Refresh and try again.');
            }
            written.push(p);
            p.saved = updated;
        }

        // ── 3. Re-check now the writes are durable, in case someone booked into
        //       one of these slots while we were writing.
        for (const p of planned) {
            const raced = await hasConflictingAppointment(
                providerId, p.appointmentDate, p.startTime, p.endTime, [p.id], p.scope,
            );
            if (raced) {
                return failed(409, 'That time was just taken. Please pick another.');
            }
        }

        } catch (err) {
            // A transient query failure part-way through must not leave the day
            // half-moved when we are still able to put it back.
            logger.error({ err }, 'Batch reschedule failed mid-write — compensating');
            return failed(500, 'That move could not be completed.');
        }

        res.status(200).json({ success: true, data: planned.map((p) => p.saved) });

        // ── 4. Tell each client once, with their FINAL time ─────────────────
        // One message per booking, sent after the response so a slow mailer never
        // holds up the drag. A customer shunted twice in one batch is impossible
        // here by construction: each booking appears in `moves` at most once.
        setImmediate(async () => {
            for (const p of planned) {
                try {
                    const appt = await Appointment.findById(p.id).populate('service').populate('customer', 'name email');
                    if (!appt) continue;
                    const to = clientContact(appt);
                    const dateStr = new Date(appt.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                    if (to.userId) {
                        await createNotification(to.userId, `${ApptPhrase(appt.service?.name)} has been moved to ${dateStr} at ${p.startTime}.`, 'appointment', '/appointments');
                    }
                    if (to.email) {
                        const providerDoc = await User.findById(providerId).select('name businessProfile');
                        const location = providerDoc?.businessProfile?.address || undefined;
                        const { gcalUrl, ics } = calendarHelper.appointmentCalendar(appt, { description: 'Booked via Bookplus', location, status: 'CONFIRMED', sequence: 1 });
                        const manageUrl = appt.manageToken && primaryOrigin() ? `${primaryOrigin()}/manage/${appt.manageToken}` : undefined;
                        await sendAppointmentRescheduledClient(to.email, to.name, appt.service?.name, dateStr, `${p.startTime} – ${p.endTime}`, { gcalUrl, ics, manageUrl });
                    }
                } catch (err) {
                    logger.error({ err, appointmentId: p.id }, 'Batch reschedule notification failed');
                }
            }
        });
    } catch (error) {
        logger.error({ err: error }, 'Batch reschedule failed');
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/**
 * A customer moving a booking must land inside the assigned staff member's
 * ROSTERED hours — their shift for that date, else their weekly pattern.
 *
 * Both customer-facing reschedule paths checked business hours, appointment
 * conflicts and blocked time, but never the staff member's own availability.
 * So shifts and breaks were enforced when a booking was CREATED and nowhere
 * else: a customer could book a legal slot and then reschedule straight onto
 * the member's rostered day off, auto-confirmed. Providers keep their override
 * — this is only applied to customer-like callers, exactly as at booking time.
 */
const staffUnavailableMessage = async (appointment, appointmentDate, startTime, endTime) => {
    const tmId = appointment.teamMember?._id || appointment.teamMember;
    if (!tmId) return null;                      // owner's own column
    const member = await TeamMember.findById(tmId).select('_id');
    if (!member) return null;
    const providerId = appointment.provider || appointment.service?.provider;
    const businessSchedule = providerId ? await getProviderSchedule(providerId) : null;
    const reason = await staffHoursReason({ member, date: appointmentDate, startTime, endTime, businessSchedule });
    return reason ? (UNAVAILABLE_MESSAGES[reason] || 'That staff member is not available then.') : null;
};

exports.rescheduleAppointment = async (req, res) => {
    try {
        const { appointmentDate, startTime } = req.body;
        if (!appointmentDate || !startTime) {
            return res.status(400).json({ success: false, message: 'appointmentDate and startTime are required' });
        }
        const appointment = await Appointment.findById(req.params.id)
            .populate('service')
            .populate('customer', 'name email');
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        // Guest appointments (no customer account) can only be rescheduled via the
        // /manage/:token flow, never this signed-in route.
        if (!appointment.customer || appointment.customer._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        if (!['pending', 'confirmed'].includes(appointment.status)) {
            return res.status(400).json({ success: false, message: 'Only pending or confirmed appointments can be rescheduled' });
        }
        if (isPastSlot(appointmentDate, startTime)) {
            return res.status(400).json({ success: false, message: 'That time has already passed. Please pick a later slot.' });
        }
        // A booking whose start already passed is history — not reschedulable.
        if (isPastSlot(appointment.appointmentDate, appointment.startTime)) {
            return res.status(400).json({ success: false, message: 'This appointment has already taken place and can no longer be rescheduled.' });
        }
        // Moving a booking inside the notice window is a cancellation in disguise.
        {
            const pid = appointment.provider || appointment.service?.provider;
            const policy = await checkCancellationWindow(pid, appointment.appointmentDate, appointment.startTime);
            if (!policy.allowed) {
                return res.status(400).json({ success: false, message: policy.message });
            }
        }

        const duration = appointment.service?.duration || 30;
        const [hours, minutes] = startTime.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes + duration;
        const endHours = Math.floor(totalMinutes / 60) % 24;
        const endMins = totalMinutes % 60;
        const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;

        if (!validBookingWindow(startTime, endTime)) {
            return res.status(400).json({ success: false, message: 'That time would run past midnight. Pick an earlier start.' });
        }

        const providerId = appointment.provider || appointment.service?.provider;
        if (providerId) {
            const schedule = await getProviderSchedule(providerId);
            // A shift for the assigned member overrides business hours for that
            // date; staffUnavailableMessage below (staffHoursReason) then enforces
            // the shift's own slots/breaks, so this can't open an uncovered slot.
            const shiftGoverns = await shiftGovernsHours(appointment.teamMember, appointmentDate);
            if (!shiftGoverns && !isTimeWithinSchedule(schedule, appointmentDate, startTime, duration)) {
                return res.status(400).json({ success: false, message: 'Selected time is outside the provider availability schedule' });
            }
            const conflict = await hasConflictingAppointment(providerId, appointmentDate, startTime, endTime, appointment._id, conflictScope(appointment));
            if (conflict) {
                return res.status(400).json({ success: false, message: 'This time slot is already booked' });
            }
            // Same hard stop as booking: a customer must not be able to move an
            // appointment onto time the provider has blocked off.
            if (await overlapsBlockedTime({
                providerId, appointmentDate, startTime, endTime, teamMember: appointment.teamMember || null,
            })) {
                return res.status(400).json({ success: false, message: BLOCKED_MESSAGE });
            }
            const unavailable = await staffUnavailableMessage(appointment, appointmentDate, startTime, endTime);
            if (unavailable) return res.status(400).json({ success: false, message: unavailable });
        }

        // Keep the old slot so the write can be undone if it lost a race.
        const previousSlot = { appointmentDate: appointment.appointmentDate, startTime: appointment.startTime, endTime: appointment.endTime };
        appointment.appointmentDate = new Date(appointmentDate);
        appointment.startTime = startTime;
        appointment.endTime = endTime;
        // The slot already passed the schedule + conflict checks above, so it's free —
        // auto-confirm instead of dropping back to pending (no provider action needed).
        appointment.status = 'confirmed';
        await appointment.save();
        if (await revertRescheduleIfRaced(appointment, previousSlot)) {
            return res.status(409).json({ success: false, message: 'That time was just taken. Please pick another.' });
        }

        try {
            if (appointment.provider) {
                const provider = await User.findById(appointment.provider);
                if (provider) {
                    const date = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                    await sendAppointmentRescheduled(
                        provider.email,
                        provider.name,
                        clientContact(appointment).name,
                        appointment.service.name,
                        date,
                        startTime
                    );
                }
            }
        } catch (emailErr) {
            logger.error({ err: emailErr }, 'Reschedule email failed');
        }

        res.status(200).json({ success: true, data: appointment });

        // Confirm the new time to the customer (in-app + push + email with updated
        // calendar) and give the provider an in-app heads-up.
        setImmediate(async () => {
            try {
                const dateStr = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                const cc = clientContact(appointment);
                if (cc.userId) await createNotification(cc.userId, `${ApptPhrase(appointment.service.name)} has been moved to ${dateStr} at ${startTime}.`, 'appointment', '/appointments');
                if (appointment.provider) {
                    await createNotification(appointment.provider, `${cc.name} rescheduled ${theirApptPhrase(appointment.service.name)} to ${dateStr} at ${startTime}.`, 'appointment', '/dashboard');
                }
                if (cc.email) {
                    const { gcalUrl, ics } = calendarHelper.appointmentCalendar(appointment, { description: 'Booked via Bookplus', status: 'CONFIRMED', sequence: 1 });
                    const manageUrl = appointment.manageToken && primaryOrigin() ? `${primaryOrigin()}/manage/${appointment.manageToken}` : undefined;
                    await sendAppointmentRescheduledClient(cc.email, cc.name, appointment.service.name, dateStr, startTime, { gcalUrl, ics, manageUrl });
                }
            } catch (err) { logger.error({ err }, 'Customer reschedule notification failed'); }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/* --- Group Bookings --- */
exports.createGroupBooking = async (req, res) => {
    try {
        const { service, appointmentDate, startTime, endTime, clients, groupSize, notes, teamMember } = req.body;
        if (!clients || !Array.isArray(clients) || clients.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one client is required' });
        }
        if (!validBookingWindow(startTime, endTime)) {
            return res.status(400).json({ success: false, message: 'A booking must end after it starts, on the same day.' });
        }
        const svc = await Service.findById(service);
        if (!svc) return res.status(404).json({ success: false, message: 'Service not found' });

        // This path used to insert straight to the DB with no validation at all,
        // while the single-booking path enforced every one of these. Flipping the
        // "Group booking" toggle in the dashboard was enough to write over an
        // existing client's slot, or to reference another business's service or
        // staff. The guards below bring it back to parity.
        const providerId = svc.provider || null;

        // The service must belong to the caller — otherwise another business's
        // service id could be booked onto this provider's calendar.
        if (providerId && String(providerId) !== String(req.user._id)) {
            return res.status(403).json({ success: false, message: 'That service does not belong to your business' });
        }

        // Same per-staff resolution every other booking path runs: confirms the
        // requested member is on THIS provider's roster and performs the service.
        let resolvedTeamMember = teamMember || null;
        if (providerId) {
            const resolution = await resolveBookingStaff({
                svc, providerId, appointmentDate, startTime, endTime,
                requestedTeamMember: teamMember || null, requester: req.user,
            });
            if (resolution.error) {
                return res.status(resolution.status).json({ success: false, message: resolution.error });
            }
            resolvedTeamMember = resolution.teamMember;
        }

        // Every named client must be an EXISTING client of this provider — the same
        // gate createAppointment applies to book-on-behalf. Without it a provider
        // could attach a confirmed booking to (and then read the name + email of)
        // any account on the platform just by supplying its id, and that fabricated
        // relationship also satisfies the isMyClient check on later single bookings.
        // Name-only entries are walk-ins and need no pre-existing relationship.
        const namedClientIds = [...new Set(
            clients.filter(c => c && c.customerId).map(c => String(c.customerId))
        )];
        if (namedClientIds.length) {
            const known = await User.find({ _id: { $in: namedClientIds }, role: 'customer' }).select('_id');
            const knownIds = new Set(known.map(u => String(u._id)));
            for (const id of namedClientIds) {
                const isMyClient = knownIds.has(id)
                    && await Appointment.exists({ customer: id, provider: req.user._id });
                if (!isMyClient) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only book on behalf of an existing client. Use a name-only entry for a first-time client.',
                    });
                }
            }
        }

        // Double-booking guard, mirroring createAppointment. A group legitimately
        // puts N clients in ONE slot, so we compare only against appointments that
        // ALREADY exist — the group's own rows are inserted together below and
        // must not be treated as conflicting with each other.
        if (providerId) {
            const [newSH, newSM] = startTime.split(':').map(Number);
            const [newEH, newEM] = endTime.split(':').map(Number);
            const newStart = newSH * 60 + newSM - (svc.bufferBefore || 0);
            const newEnd = newEH * 60 + newEM + (svc.bufferAfter || 0);
            const dayStart = new Date(appointmentDate); dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(appointmentDate); dayEnd.setHours(23, 59, 59, 999);
            const existing = await Appointment.find({
                provider: providerId,
                appointmentDate: { $gte: dayStart, $lte: dayEnd },
                status: { $nin: ['cancelled'] },
                teamMember: resolvedTeamMember,
            }).select('startTime endTime');
            const hasOverlap = existing.some(a => {
                const [aSH, aSM] = a.startTime.split(':').map(Number);
                const [aEH, aEM] = a.endTime.split(':').map(Number);
                return newStart < (aEH * 60 + aEM) && newEnd > (aSH * 60 + aSM);
            });
            if (hasOverlap) {
                return res.status(400).json({ success: false, message: 'This time slot is already booked. You can join the waiting list instead.' });
            }
        }

        const gid = randomUUID();
        // `customer` is required on the model. Name-only group clients are walk-ins, so
        // they belong to the provider — exactly how a single walk-in booking resolves the
        // client to req.user. Passing null here was failing insertMany validation → 500.
        const docs = clients.map(c => ({
            customer: c.customerId || req.user._id,
            walkInName: c.customerId ? null : (c.name || 'Group Client'),
            service,
            provider: providerId || req.user._id,
            appointmentDate: new Date(appointmentDate),
            startTime,
            endTime,
            totalPrice: svc.price,
            status: 'confirmed',
            notes: notes || '',
            groupId: gid,
            groupSize: groupSize || clients.length,
            teamMember: resolvedTeamMember,
        }));
        const appointments = await Appointment.insertMany(docs);
        await createNotification(req.user._id, `Group booking created: ${clients.length} client(s) for ${servicePhrase(svc.name)}`, 'appointment', '/dashboard?tab=confirmed');
        res.status(201).json({ success: true, data: appointments });
    } catch (error) {
        logger.error({ err: error }, 'Group booking failed');
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getGroupBooking = async (req, res) => {
    try {
        const appointments = await Appointment.find({ groupId: req.params.groupId })
            .populate('customer', 'name email phone')
            .populate('service', 'name price duration')
            .sort({ createdAt: 1 });
        if (!appointments.length) return res.status(404).json({ success: false, message: 'Group booking not found' });

        // Authorization: only a participant (a customer in the group), the group's
        // provider, or an admin may view it. Without this any authenticated user who
        // guessed/obtained a groupId could read every participant's name/email/phone
        // (IDOR). The groupId being a UUID was the only prior barrier.
        const uid = req.user._id.toString();
        const authorized = req.user.role === 'admin'
            || appointments.some(a => a.customer?._id?.toString() === uid || a.provider?.toString() === uid);
        if (!authorized) return res.status(403).json({ success: false, message: 'Not authorized' });

        res.status(200).json({ success: true, data: appointments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};


/* --- No-login "manage my booking" via opaque token --- */

exports.getAppointmentByToken = async (req, res) => {
    try {
        const appt = await Appointment.findOne({ manageToken: req.params.token })
            .populate('service', 'name price duration')
            .populate('provider', 'name businessProfile bookingPolicy')
            .populate('teamMember', 'name');
        if (!appt) return res.status(404).json({ success: false, message: 'Booking not found' });
        // Provider's working hours so the reschedule picker can offer controlled
        // (hourly) slots instead of an arbitrary time input. Not sensitive — it's
        // the same availability shown publicly on the booking page.
        let schedule = null;
        if (appt.provider?._id) {
            const availabilityDoc = await Availability.findOne({ provider: appt.provider._id });
            schedule = availabilityDoc?.schedule || null;
        }
        // Only expose what a guest needs — never the full document
        res.status(200).json({
            success: true,
            data: {
                _id: appt._id,
                status: appt.status,
                appointmentDate: appt.appointmentDate,
                startTime: appt.startTime,
                endTime: appt.endTime,
                service: appt.service ? { name: appt.service.name, price: appt.service.price, duration: appt.service.duration } : null,
                provider: appt.provider ? { name: appt.provider.name, address: appt.provider.businessProfile?.address || '', currency: appt.provider.businessProfile?.currency || 'NAD' } : null,
                staff: appt.teamMember ? appt.teamMember.name : null,
                clientName: appt.walkInName || appt.guestName || null,
                schedule,
                cancellationWindowHours: appt.provider?.bookingPolicy?.cancellationWindowHours ?? 24,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.cancelAppointmentByToken = async (req, res) => {
    try {
        const appt = await Appointment.findOne({ manageToken: req.params.token })
            .populate('service', 'name')
            .populate('customer', 'name email');
        if (!appt) return res.status(404).json({ success: false, message: 'Booking not found' });
        if (!['pending', 'confirmed'].includes(appt.status)) {
            return res.status(400).json({ success: false, message: 'This booking can no longer be cancelled.' });
        }
        if (isPastSlot(appt.appointmentDate, appt.startTime)) {
            return res.status(400).json({ success: false, message: 'This appointment has already taken place and can no longer be cancelled.' });
        }
        {
            const policy = await checkCancellationWindow(appt.provider, appt.appointmentDate, appt.startTime);
            if (!policy.allowed) {
                return res.status(400).json({ success: false, message: policy.message });
            }
        }
        appt.status = 'cancelled';
        appt.cancellationReason = 'Cancelled by client via link';
        appt.statusHistory.push({ status: 'cancelled', changedBy: appt.customer?._id || null });
        await appt.save();

        // Release any held wallet funds back to available (idempotent; spec §6).
        try {
            await walletService.releaseReservation({ appointmentId: appt._id, resolvedBy: appt.customer?._id || null });
        } catch (err) { logger.error({ err }, 'Wallet release after token-cancel failed'); }

        // Tell the BUSINESS — a guest cancelling via their manage link is the one
        // cancellation path with no signed-in customer, so it used to be completely
        // silent to the owner.
        try {
            if (appt.provider) {
                const who = appt.walkInName || appt.guestName || appt.customer?.name || 'A client';
                const when = new Date(appt.appointmentDate)
                    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                await createNotification(
                    appt.provider,
                    `❌ Cancelled — ${who} cancelled ${apptPhrase(appt.service?.name)} on ${when} at ${appt.startTime}. The slot is free again.`,
                    'appointment',
                    '/dashboard'
                );
            }
        } catch (err) { logger.error({ err }, 'Provider cancellation notification failed (token path)'); }

        // Open the slot to the waiting list, like any other cancellation
        try {
            const { promoteFromWaitingList } = require('../utils/waitingListHelper');
            await promoteFromWaitingList(appt.service._id, appt.appointmentDate, appt.startTime, appt.endTime);
        } catch (err) { logger.error({ err }, 'Waitlist promotion after token-cancel failed'); }

        // Notify provider (fire-and-forget)
        setImmediate(async () => {
            try {
                if (appt.provider) {
                    const when = new Date(appt.appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    await createNotification(appt.provider, `${appt.customer?.name || appt.guestName || appt.walkInName || 'A client'} cancelled ${theirApptPhrase(appt.service?.name)} on ${when}.`, 'appointment', '/dashboard');
                }
                // Email the client a cancellation confirmation (registered or guest).
                const cc = clientContact(appt);
                if (cc.email) {
                    const whenLong = new Date(appt.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                    await sendAppointmentCancelled(cc.email, cc.name, appt.service?.name, whenLong);
                }
            } catch (err) { logger.error({ err }, 'Cancel notification failed'); }
        });

        res.status(200).json({ success: true, message: 'Your booking has been cancelled.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// No-login reschedule via the opaque manage token
exports.rescheduleAppointmentByToken = async (req, res) => {
    try {
        const { appointmentDate, startTime } = req.body;
        if (!appointmentDate || !startTime) {
            return res.status(400).json({ success: false, message: 'appointmentDate and startTime are required' });
        }
        const appt = await Appointment.findOne({ manageToken: req.params.token })
            .populate('service', 'name duration')
            .populate('customer', 'name email');
        if (!appt) return res.status(404).json({ success: false, message: 'Booking not found' });
        if (!['pending', 'confirmed'].includes(appt.status)) {
            return res.status(400).json({ success: false, message: 'This booking can no longer be rescheduled.' });
        }
        if (isPastSlot(appointmentDate, startTime)) {
            return res.status(400).json({ success: false, message: 'That time has already passed. Please pick a later slot.' });
        }
        if (isPastSlot(appt.appointmentDate, appt.startTime)) {
            return res.status(400).json({ success: false, message: 'This appointment has already taken place and can no longer be rescheduled.' });
        }
        {
            const policy = await checkCancellationWindow(appt.provider, appt.appointmentDate, appt.startTime);
            if (!policy.allowed) {
                return res.status(400).json({ success: false, message: policy.message });
            }
        }

        const duration = appt.service?.duration
            || (parseTimeToMinutes(appt.endTime) - parseTimeToMinutes(appt.startTime)) || 30;
        const tm = parseTimeToMinutes(startTime) + duration;
        const endTime = `${String(Math.floor(tm / 60) % 24).padStart(2, '0')}:${String(tm % 60).padStart(2, '0')}`;

        if (!validBookingWindow(startTime, endTime)) {
            return res.status(400).json({ success: false, message: 'That time would run past midnight. Pick an earlier start.' });
        }

        const providerId = appt.provider;
        if (providerId) {
            const availabilityDoc = await Availability.findOne({ provider: providerId });
            // A shift for the assigned member overrides business hours for that
            // date; staffUnavailableMessage below still enforces the shift itself.
            const shiftGoverns = await shiftGovernsHours(appt.teamMember, appointmentDate);
            if (availabilityDoc?.schedule && !shiftGoverns
                && !isTimeWithinSchedule(availabilityDoc.schedule, appointmentDate, startTime, duration)) {
                return res.status(400).json({ success: false, message: 'That time is outside the provider availability schedule.' });
            }
            if (await hasConflictingAppointment(providerId, appointmentDate, startTime, endTime, appt._id, conflictScope(appt))) {
                return res.status(400).json({ success: false, message: 'That time slot is already booked.' });
            }
            // Guest "manage my booking" reschedule — same blocked-time hard stop.
            const unavailableGuest = await staffUnavailableMessage(appt, appointmentDate, startTime, endTime);
            if (unavailableGuest) return res.status(400).json({ success: false, message: unavailableGuest });
            if (await overlapsBlockedTime({
                providerId, appointmentDate, startTime, endTime, teamMember: appt.teamMember || null,
            })) {
                return res.status(400).json({ success: false, message: BLOCKED_MESSAGE });
            }
        }

        // Keep the old slot so the write can be undone if it lost a race.
        const previousSlot = { appointmentDate: appt.appointmentDate, startTime: appt.startTime, endTime: appt.endTime };
        appt.appointmentDate = new Date(appointmentDate);
        appt.startTime = startTime;
        appt.endTime = endTime;
        // Free slot (checked above) → auto-confirm rather than await provider approval.
        appt.status = 'confirmed';
        appt.statusHistory.push({ status: 'confirmed', changedBy: appt.customer?._id || null });
        await appt.save();
        if (await revertRescheduleIfRaced(appt, previousSlot)) {
            return res.status(409).json({ success: false, message: 'That time was just taken. Please pick another.' });
        }

        setImmediate(async () => {
            try {
                if (appt.provider) {
                    const when = new Date(appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    await createNotification(appt.provider, `${appt.customer?.name || appt.guestName || appt.walkInName || 'A client'} rescheduled ${theirApptPhrase(appt.service?.name)} to ${when} at ${startTime}.`, 'appointment', '/dashboard');
                }
                // Confirm the new time to the client with an updated calendar entry.
                const cc = clientContact(appt);
                if (cc.email) {
                    const dateStr = new Date(appt.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                    const { gcalUrl, ics } = calendarHelper.appointmentCalendar(appt, { description: 'Booked via Bookplus', status: 'CONFIRMED', sequence: 1 });
                    const manageUrl = primaryOrigin() ? `${primaryOrigin()}/manage/${req.params.token}` : undefined;
                    await sendAppointmentRescheduledClient(cc.email, cc.name, appt.service?.name, dateStr, startTime, { gcalUrl, ics, manageUrl });
                    if (cc.userId) await createNotification(cc.userId, `${ApptPhrase(appt.service?.name)} has been moved to ${dateStr} at ${startTime}.`, 'appointment', '/appointments');
                }
            } catch (err) { logger.error({ err }, 'Reschedule notification failed'); }
        });

        res.status(200).json({ success: true, message: 'Your booking has been rescheduled.', data: { appointmentDate: appt.appointmentDate, startTime: appt.startTime, endTime: appt.endTime } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
