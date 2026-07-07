const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const { randomUUID } = require('crypto');
const Appointment = require('../models/Appointment');
const Availability = require('../models/Availability');
const Service = require('../models/Service');
const User = require('../models/User');
const { createNotification, notifyAdmins } = require('../utils/notificationhelper');
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
const { resolveBookingStaff } = require('../utils/staffBooking');
const { checkCancellationWindow } = require('../utils/cancellationPolicy');
const { primaryOrigin } = require('../utils/origins');

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

const timesOverlap = (startA, endA, startB, endB) => startA < endB && endA > startB;

// True if the given date + start time is in the past (1-minute grace).
// Used to stop customers booking/rescheduling into a time that has already passed.
const isPastSlot = (appointmentDate, startTime) => {
    const dt = new Date(appointmentDate);
    if (isNaN(dt.getTime())) return false; // let other validation handle bad dates
    const [h, m] = String(startTime).split(':').map(Number);
    dt.setHours(h || 0, m || 0, 0, 0);
    return dt.getTime() < Date.now() - 60 * 1000;
};

const getProviderSchedule = async (providerId) => {
    if (!providerId) return defaultSchedule;
    const availability = await Availability.findOne({ provider: providerId });
    return availability?.schedule || defaultSchedule;
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

const hasConflictingAppointment = async (providerId, appointmentDate, startTime, endTime, excludeId) => {
    if (!providerId) return false;
    const start = new Date(appointmentDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(appointmentDate);
    end.setHours(23, 59, 59, 999);
    const existing = await Appointment.find({
        provider: providerId,
        appointmentDate: { $gte: start, $lte: end },
        status: { $nin: ['cancelled'] },
        _id: { $ne: excludeId },
    }).select('startTime endTime');
    const newStart = parseTimeToMinutes(startTime);
    const newEnd = parseTimeToMinutes(endTime);
    return existing.some(a => timesOverlap(newStart, newEnd, parseTimeToMinutes(a.startTime), parseTimeToMinutes(a.endTime)));
};

/**
 * GET /api/appointments/booked-slots?providerId=&date=YYYY-MM-DD
 * Public — returns start/end times of all non-cancelled appointments for a provider on a given date.
 * Used by the booking page to grey out taken time slots.
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

        const appointments = await Appointment.find(query)
            .select('startTime endTime teamMember -_id');

        res.status(200).json({ success: true, data: appointments });
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
            // A staff principal sees ONLY their own column at their business —
            // never the whole platform (the bare fall-through is admin-only).
            const TeamMember = require('../models/TeamMember');
            const member = await TeamMember.findOne({ user: req.user._id, provider: req.user.staffOf });
            if (!member) return res.status(200).json({ success: true, data: [] });
            query = { provider: req.user.staffOf, teamMember: member._id };
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
        const base = () => Appointment.find(query)
            .populate('customer', 'name email phone')
            .populate('service', 'name price duration')
            .populate('teamMember', 'name color')
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
                populate: { path: 'provider', select: 'name avatar businessProfile.businessName businessProfile.address businessProfile.locationType portfolio.images' },
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

/* Helper: advance a date by `interval` recurrence units (every N days/weeks/months) */
const advanceDate = (date, type, interval = 1) => {
    const d = new Date(date);
    const n = Math.max(1, parseInt(interval, 10) || 1);
    if (type === 'daily')   d.setDate(d.getDate() + n);
    if (type === 'weekly')  d.setDate(d.getDate() + 7 * n);
    if (type === 'monthly') d.setMonth(d.getMonth() + n);
    return d;
};

exports.createAppointment = async (req, res) => {
    try {
        const { service, appointmentDate, startTime, endTime, notes, selectedAddOns, walkInName, customerId,
                isRecurring, recurrenceType, recurrenceInterval, recurrenceEndDate, teamMember, paymentMethod } = req.body;
        if (!service || !appointmentDate || !startTime || !endTime) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }
        const svc = await Service.findById(service);
        if (!svc) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }
        const isProviderBooking = req.user.role === 'provider';

        // A provider booking from their calendar can either log a walk-in (free-text
        // name) or book on behalf of an existing registered client (customerId).
        // Resolve who the appointment is actually FOR, so the confirmation email,
        // reminders and in-app notice reach the real client — not the provider.
        let bookingClient = req.user;
        if (isProviderBooking && customerId) {
            const client = await User.findById(customerId).select('name email phone');
            if (!client) {
                return res.status(404).json({ success: false, message: 'Selected client not found' });
            }
            bookingClient = client;
        }

        // Respect blocks — once either party blocks the other, no booking between them.
        if (req.user.role === 'customer' && svc.provider) {
            const prov = await User.findById(svc.provider).select('blockedUsers');
            const iBlocked = (req.user.blockedUsers || []).map(String).includes(svc.provider.toString());
            const blockedByProvider = (prov?.blockedUsers || []).map(String).includes(req.user._id.toString());
            if (iBlocked || blockedByProvider) {
                return res.status(403).json({ success: false, message: 'Booking is unavailable between you and this provider.' });
            }
        }

        // Customers cannot book a time that has already passed. Providers/admins may
        // back-date (e.g. logging a walk-in that just happened).
        if (req.user.role === 'customer' && isPastSlot(appointmentDate, startTime)) {
            return res.status(400).json({ success: false, message: 'That time has already passed. Please pick a later slot.' });
        }

        // Block double-bookings: check provider time overlap (not just same service+time)
        const providerId = svc.provider;

        // Enforce the provider's published availability for customer bookings. Providers
        // may book outside hours (walk-ins/overrides). Only enforced when availability
        // has actually been set, so providers who never published hours aren't blocked.
        if (req.user.role === 'customer' && providerId) {
            const availabilityDoc = await Availability.findOne({ provider: providerId });
            if (availabilityDoc?.schedule) {
                const bookingDuration = parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime);
                if (!isTimeWithinSchedule(availabilityDoc.schedule, appointmentDate, startTime, bookingDuration)) {
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
                requestedTeamMember: teamMember || null, requester: req.user,
            });
            if (resolution.error) {
                return res.status(resolution.status).json({ success: false, message: resolution.error });
            }
            resolvedTeamMember = resolution.teamMember;
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

        const basePrice = (svc.price || 0) + (Array.isArray(selectedAddOns) ? selectedAddOns.reduce((sum, a) => sum + (a.price || 0), 0) : 0);

        // Resolve how this booking is paid. When the provider's wallet is on, the
        // client picks wallet or cash (falling back to the provider's default);
        // otherwise it's a plain cash/pay-later booking.
        let walletCfg = null;
        let chosenMethod = 'cash';
        if (svc.provider) {
            const provWallet = await User.findById(svc.provider).select('walletSettings');
            walletCfg = provWallet?.walletSettings || null;
            if (walletCfg?.enabled) {
                chosenMethod = (paymentMethod === 'wallet' || paymentMethod === 'cash')
                    ? paymentMethod
                    : (walletCfg.bookingPaymentMode === 'wallet_required' ? 'wallet' : 'cash');
            }
        }

        const baseDoc = {
            customer: bookingClient._id,
            service,
            provider: svc.provider || null,
            startTime,
            endTime,
            notes: notes || '',
            selectedAddOns: Array.isArray(selectedAddOns) ? selectedAddOns : [],
            totalPrice: basePrice,
            status: 'confirmed',
            statusHistory: [{ status: 'confirmed', changedBy: req.user._id }],
            // Walk-in name only when the provider didn't pick a registered client.
            walkInName: isProviderBooking && !customerId ? (walkInName?.trim() || null) : null,
            teamMember: resolvedTeamMember,
            paymentMethod: chosenMethod,
            manageToken: randomUUID(),
        };

        let appointment;

        if (isRecurring && recurrenceType && ['daily', 'weekly', 'monthly'].includes(recurrenceType)) {
            const groupId = randomUUID();
            // Repeat every N units (the "Custom" frequency); defaults to every 1.
            const interval = Math.min(52, Math.max(1, parseInt(recurrenceInterval, 10) || 1));
            const seriesEnd = recurrenceEndDate ? new Date(recurrenceEndDate) : (() => {
                const d = new Date(appointmentDate);
                d.setMonth(d.getMonth() + 3);
                return d;
            })();
            const docs = [];
            let cur = new Date(appointmentDate);
            const MAX = 60;
            while (cur <= seriesEnd && docs.length < MAX) {
                docs.push({ ...baseDoc, appointmentDate: new Date(cur), isRecurring: true, recurrenceType, recurrenceInterval: interval, recurrenceGroupId: groupId, recurrenceEndDate: seriesEnd, manageToken: randomUUID() });
                cur = advanceDate(cur, recurrenceType, interval);
            }
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
        const reservationClientId = req.user.role === 'customer'
            ? req.user._id
            : (isProviderBooking && customerId ? bookingClient._id : null);
        if (reservationClientId && svc.provider && !isRecurring && walletCfg?.enabled && chosenMethod === 'wallet') {
            try {
                const result = await walletService.reserveFunds({
                    customer: reservationClientId, provider: svc.provider,
                    amount: basePrice, appointmentId: appointment._id, initiatedBy: req.user._id,
                });
                if (!result.ok) {
                    if (req.user.role === 'customer') {
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
                    createNotification(reservationClientId, `N$${basePrice.toFixed(2)} reserved for your ${svc.name} booking`, 'wallet', '/wallet');
                }
            } catch (walletErr) {
                logger.error({ err: walletErr }, 'Wallet reservation failed');
            }
        }

        // Respond immediately — notifications and email run in the background
        res.status(201).json({ success: true, message: 'Appointment confirmed', data: appointment });

        // Notify the provider (in-app) and alert admins of the new booking (fire-and-forget)
        setImmediate(async () => {
            try {
                const bookingDate = new Date(appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                // Who the booking is for, in human terms — the registered client, the
                // walk-in's name, or (for a self-booking) the customer themselves.
                const clientLabel = isProviderBooking
                    ? (customerId ? bookingClient.name : (walkInName?.trim() || 'a walk-in client'))
                    : req.user.name;
                const priceTag = Number.isFinite(basePrice) ? ` (N$${basePrice.toFixed(2)})` : '';
                if (svc.provider) {
                    await createNotification(
                        svc.provider,
                        `🎉 New booking — ${clientLabel} booked ${svc.name}${priceTag} on ${bookingDate} at ${startTime}`,
                        'appointment',
                        '/dashboard'
                    );
                }
                // When a provider books an existing client, let that client know.
                if (isProviderBooking && customerId) {
                    await createNotification(
                        bookingClient._id,
                        `✅ You're booked — ${svc.name} with ${req.user.name} on ${bookingDate} at ${startTime}`,
                        'appointment',
                        '/appointments'
                    );
                }
                await notifyAdmins(
                    `New booking: ${svc.name} by ${clientLabel} on ${bookingDate} at ${startTime}`,
                    'system',
                    '/bkplus-command'
                );
            } catch (err) { logger.error({ err }, 'Booking notification failed'); }

            try {
                const dateStr = new Date(appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                const timeStr = `${startTime} – ${endTime}`;
                const _pad = (n) => String(n).padStart(2, '0');
                const _fmt = (d) => `${d.getFullYear()}${_pad(d.getMonth()+1)}${_pad(d.getDate())}T${_pad(d.getHours())}${_pad(d.getMinutes())}00`;
                const _base = new Date(appointmentDate);
                const [_sh, _sm] = startTime.split(':').map(Number);
                const [_eh, _em] = endTime.split(':').map(Number);
                const _gcalStart = new Date(_base.getFullYear(), _base.getMonth(), _base.getDate(), _sh, _sm);
                const _gcalEnd = new Date(_base.getFullYear(), _base.getMonth(), _base.getDate(), _eh, _em);
                const gcalUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(svc.name)}&dates=${_fmt(_gcalStart)}/${_fmt(_gcalEnd)}&details=${encodeURIComponent('Booked via Bookplus')}`;

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

exports.updateAppointment = async (req, res) => {
    try {
        const appointment = await Appointment.findById(req.params.id).populate('service');
        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment not found' });
        }
        if (appointment.customer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
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
                if (await hasConflictingAppointment(providerId, newDate, newStart, newEnd, appointment._id)) {
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
        if (appointment.customer._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
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
            await sendAppointmentCancelled(
                appointment.customer.email,
                appointment.customer.name,
                appointment.service.name,
                date
            );
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

        await Appointment.updateMany(filter, { $set: { status: 'cancelled', cancellationReason: 'Recurring series cancelled' } });
        res.status(200).json({ success: true, message: 'Series cancelled' });
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
        appointment.status = status;
        appointment.statusHistory.push({ status, changedBy: req.user._id });
        await appointment.save();

        // Wallet money movement on status change — idempotent, and a no-op when the
        // booking carried no reservation. Completing turns the hold into a permanent
        // deduction (spec §5); cancelling releases it back to available (spec §6).
        try {
            if (status === 'completed') {
                const r = await walletService.deductForCompletion({ appointmentId: appointment._id, resolvedBy: req.user._id });
                if (r.deducted > 0) createNotification(appointment.customer._id, `N$${r.deducted.toFixed(2)} deducted from your wallet for ${appointment.service?.name}`, 'wallet', '/wallet');
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
            confirmed: `Your appointment for ${appointment.service?.name} has been confirmed!`,
            completed: `Your appointment for ${appointment.service?.name} is marked as completed. Leave a review!`,
            cancelled: `Your appointment for ${appointment.service?.name} has been cancelled.`,
            'no-show': `You missed your appointment for ${appointment.service?.name}. Contact your provider to rebook.`,
        };
        if (messages[status]) {
            await createNotification(appointment.customer._id, messages[status], 'appointment', '/appointments');
        }

        // Send email notification
        try {
            const customerEmail = appointment.customer?.email;
            const customerName = appointment.customer?.name;
            const serviceName = appointment.service?.name;
            const date = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            const time = `${appointment.startTime} – ${appointment.endTime}`;

            if (status === 'confirmed') {
                const _pad = (n) => String(n).padStart(2, '0');
                const _fmt = (d) => `${d.getFullYear()}${_pad(d.getMonth()+1)}${_pad(d.getDate())}T${_pad(d.getHours())}${_pad(d.getMinutes())}00`;
                const _base = new Date(appointment.appointmentDate);
                const [_sh, _sm] = (appointment.startTime || '09:00').split(':').map(Number);
                const [_eh, _em] = (appointment.endTime || '10:00').split(':').map(Number);
                const _gcalStart = new Date(_base.getFullYear(), _base.getMonth(), _base.getDate(), _sh, _sm);
                const _gcalEnd = new Date(_base.getFullYear(), _base.getMonth(), _base.getDate(), _eh, _em);
                const gcalUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(serviceName)}&dates=${_fmt(_gcalStart)}/${_fmt(_gcalEnd)}&details=${encodeURIComponent('Booked via Bookplus')}`;
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
        if (appointment.provider.toString() !== req.user._id.toString()) {
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

        const providerId = appointment.provider;
        const schedule = await getProviderSchedule(providerId);
        if (!isTimeWithinSchedule(schedule, appointmentDate, startTime, duration)) {
            return res.status(400).json({ success: false, message: 'Selected time is outside your availability schedule' });
        }

        const conflict = await hasConflictingAppointment(providerId, appointmentDate, startTime, endTime, appointment._id);
        if (conflict) {
            return res.status(400).json({ success: false, message: 'This time slot is already booked' });
        }

        appointment.appointmentDate = new Date(appointmentDate);
        appointment.startTime = startTime;
        appointment.endTime = endTime;
        await appointment.save();
        res.status(200).json({ success: true, data: appointment });

        // Tell the client their provider moved the appointment (previously silent).
        setImmediate(async () => {
            try {
                const customer = appointment.customer ? await User.findById(appointment.customer).select('name email') : null;
                if (!customer) return; // walk-in / no account — nothing to notify
                const dateStr = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                await createNotification(customer._id, `Your ${appointment.service?.name || 'appointment'} was moved to ${dateStr} at ${startTime}.`, 'appointment', '/appointments');
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
        if (appointment.customer._id.toString() !== req.user._id.toString()) {
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

        const providerId = appointment.provider || appointment.service?.provider;
        if (providerId) {
            const schedule = await getProviderSchedule(providerId);
            if (!isTimeWithinSchedule(schedule, appointmentDate, startTime, duration)) {
                return res.status(400).json({ success: false, message: 'Selected time is outside the provider availability schedule' });
            }
            const conflict = await hasConflictingAppointment(providerId, appointmentDate, startTime, endTime, appointment._id);
            if (conflict) {
                return res.status(400).json({ success: false, message: 'This time slot is already booked' });
            }
        }

        appointment.appointmentDate = new Date(appointmentDate);
        appointment.startTime = startTime;
        appointment.endTime = endTime;
        // The slot already passed the schedule + conflict checks above, so it's free —
        // auto-confirm instead of dropping back to pending (no provider action needed).
        appointment.status = 'confirmed';
        await appointment.save();

        try {
            if (appointment.provider) {
                const provider = await User.findById(appointment.provider);
                if (provider) {
                    const date = new Date(appointment.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                    await sendAppointmentRescheduled(
                        provider.email,
                        provider.name,
                        appointment.customer.name,
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
                await createNotification(appointment.customer._id, `Your ${appointment.service.name} is now ${dateStr} at ${startTime}.`, 'appointment', '/appointments');
                if (appointment.provider) {
                    await createNotification(appointment.provider, `${appointment.customer.name} rescheduled ${appointment.service.name} to ${dateStr} at ${startTime}.`, 'appointment', '/dashboard');
                }
                if (appointment.customer.email) {
                    const { gcalUrl, ics } = calendarHelper.appointmentCalendar(appointment, { description: 'Booked via Bookplus', status: 'CONFIRMED', sequence: 1 });
                    const manageUrl = appointment.manageToken && primaryOrigin() ? `${primaryOrigin()}/manage/${appointment.manageToken}` : undefined;
                    await sendAppointmentRescheduledClient(appointment.customer.email, appointment.customer.name, appointment.service.name, dateStr, startTime, { gcalUrl, ics, manageUrl });
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
        const svc = await Service.findById(service);
        if (!svc) return res.status(404).json({ success: false, message: 'Service not found' });
        const gid = randomUUID();
        // `customer` is required on the model. Name-only group clients are walk-ins, so
        // they belong to the provider — exactly how a single walk-in booking resolves the
        // client to req.user. Passing null here was failing insertMany validation → 500.
        const docs = clients.map(c => ({
            customer: c.customerId || req.user._id,
            walkInName: c.customerId ? null : (c.name || 'Group Client'),
            service,
            provider: req.user._id,
            appointmentDate: new Date(appointmentDate),
            startTime,
            endTime,
            totalPrice: svc.price,
            status: 'confirmed',
            notes: notes || '',
            groupId: gid,
            groupSize: groupSize || clients.length,
            teamMember: teamMember || null,
        }));
        const appointments = await Appointment.insertMany(docs);
        await createNotification(req.user._id, `Group booking created: ${clients.length} client(s) for ${svc.name}`, 'appointment', '/dashboard?tab=confirmed');
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
                provider: appt.provider ? { name: appt.provider.name, address: appt.provider.businessProfile?.address || '' } : null,
                staff: appt.teamMember ? appt.teamMember.name : null,
                clientName: appt.walkInName || null,
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
                    await createNotification(appt.provider, `${appt.customer?.name || appt.walkInName || 'A client'} cancelled ${appt.service?.name} on ${when}.`, 'appointment', '/dashboard');
                }
                // Email the client a cancellation confirmation (the logged-in path already does this).
                if (appt.customer?.email) {
                    const whenLong = new Date(appt.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                    await sendAppointmentCancelled(appt.customer.email, appt.customer.name, appt.service?.name, whenLong);
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

        const providerId = appt.provider;
        if (providerId) {
            const availabilityDoc = await Availability.findOne({ provider: providerId });
            if (availabilityDoc?.schedule && !isTimeWithinSchedule(availabilityDoc.schedule, appointmentDate, startTime, duration)) {
                return res.status(400).json({ success: false, message: 'That time is outside the provider availability schedule.' });
            }
            if (await hasConflictingAppointment(providerId, appointmentDate, startTime, endTime, appt._id)) {
                return res.status(400).json({ success: false, message: 'That time slot is already booked.' });
            }
        }

        appt.appointmentDate = new Date(appointmentDate);
        appt.startTime = startTime;
        appt.endTime = endTime;
        // Free slot (checked above) → auto-confirm rather than await provider approval.
        appt.status = 'confirmed';
        appt.statusHistory.push({ status: 'confirmed', changedBy: appt.customer?._id || null });
        await appt.save();

        setImmediate(async () => {
            try {
                if (appt.provider) {
                    const when = new Date(appointmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    await createNotification(appt.provider, `${appt.customer?.name || appt.walkInName || 'A client'} rescheduled ${appt.service?.name} to ${when} at ${startTime}.`, 'appointment', '/dashboard');
                }
                // Confirm the new time to the client with an updated calendar entry.
                if (appt.customer?.email) {
                    const dateStr = new Date(appt.appointmentDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                    const { gcalUrl, ics } = calendarHelper.appointmentCalendar(appt, { description: 'Booked via Bookplus', status: 'CONFIRMED', sequence: 1 });
                    const manageUrl = primaryOrigin() ? `${primaryOrigin()}/manage/${req.params.token}` : undefined;
                    await sendAppointmentRescheduledClient(appt.customer.email, appt.customer.name, appt.service?.name, dateStr, startTime, { gcalUrl, ics, manageUrl });
                    if (appt.customer._id) await createNotification(appt.customer._id, `Your ${appt.service?.name} is now ${dateStr} at ${startTime}.`, 'appointment', '/appointments');
                }
            } catch (err) { logger.error({ err }, 'Reschedule notification failed'); }
        });

        res.status(200).json({ success: true, message: 'Your booking has been rescheduled.', data: { appointmentDate: appt.appointmentDate, startTime: appt.startTime, endTime: appt.endTime } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
