const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const ClientNote = require('../models/ClientNote');
const TeamMember = require('../models/TeamMember');
const { memberInvolvedFilter } = require('../utils/staffBooking');

// The business a request acts on. For an owner it's their own id; for a staff
// member (Medium tier, clients:* capability) it's the business they work for, so
// the provider-scoped queries below double as the cross-tenant guard — a staff
// principal only ever reaches their own employer's clients. Returns null for a
// staff account with no employer (detached), which the handlers reject.
const businessScope = (req) => (req.user.role === 'staff' ? req.user.staffOf || null : req.user._id);

/**
 * WHICH clients this request may read — the business scope narrowed by assignment.
 *
 * The owner (and admin) sees every client of the business. A STAFF member sees
 * only the clients they are ASSIGNED to: the bookings they personally perform,
 * top-level or as one segment of a multi-service ticket. That is what the spec
 * always specified — DUAL_APP_SPEC §2b ("/clients … provider/admin, staff(assigned)"),
 * §4.2 ("a staff principal is scoped to staffOf and, for calendar/clients, to
 * their own assignments") and the Epic 2.4 AC ("an invited staff … sees only
 * their calendar + assigned clients") — but `clients:assigned` was a no-op, so a
 * Medium-tier staff member got the WHOLE client list instead.
 *
 * Nothing widens a team member here — seeing every client is the owner's view
 * alone (there are no access levels or add-ons any more). This mirrors buildAppointmentScope in
 * appointmentController (same memberInvolvedFilter, so the calendar and the CRM
 * can never disagree about which bookings are "theirs").
 *
 * Returns { forbidden } for a detached staff account, { empty } for a staff
 * member with no roster row (they perform nothing, so they have no clients), or
 * { providerId, filter, assigned } — `assigned` true when the filter is
 * narrowed to this member's own bookings, false for a whole-business view.
 */
const buildClientScope = async (req) => {
    const providerId = businessScope(req);
    if (!providerId) return { forbidden: true };
    if (req.user.role !== 'staff') return { providerId, filter: { provider: providerId }, assigned: false };
    // A team member sees the clients they personally serve — never the whole
    // business's list, which is the owner's alone.
    const member = await TeamMember.findOne({ user: req.user._id, provider: providerId }).select('_id');
    if (!member) return { providerId, empty: true };
    return { providerId, filter: { provider: providerId, ...memberInvolvedFilter(member._id) }, assigned: true };
};

// Get all unique clients who have used this provider's services — registered
// customers (booked online) AND walk-ins logged by the provider. A walk-in has
// no account, so its appointment carries the provider's own id as `customer`
// plus a `walkInName`; we surface those as their own clients (keyed by name)
// instead of lumping them under the provider.
exports.getMyClients = async (req, res) => {
    try {
        const scope = await buildClientScope(req);
        if (scope.forbidden) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        // A staff member with no roster row performs nothing, so they have no
        // assigned clients — an empty list, not an error.
        if (scope.empty) return res.status(200).json({ success: true, data: [] });
        const { providerId } = scope;
        const providerIdStr = providerId.toString();

        // Only the fields the per-client roll-up below reads — as lean plain
        // objects, and with the never-referenced service join dropped. This was
        // hydrating the provider's whole appointment history (two populates) just
        // to reduce it to one row per client. `avatar` feeds the New Appointment
        // client list's picture (an additive field: older clients ignore it).
        const appointments = await Appointment.find(scope.filter)
            .select('customer walkInName status totalPrice appointmentDate')
            .populate('customer', 'name email phone avatar createdAt')
            .sort({ appointmentDate: -1 })
            .lean();

        const clientMap = new Map();
        for (const appt of appointments) {
            let key, customer, isWalkIn = false;
            if (appt.walkInName && appt.walkInName.trim()) {
                const name = appt.walkInName.trim();
                key = `walkin:${name.toLowerCase()}`;
                customer = { _id: key, name, email: null, phone: null, avatar: null, isWalkIn: true };
                isWalkIn = true;
            } else if (appt.customer && appt.customer._id.toString() !== providerIdStr) {
                key = appt.customer._id.toString();
                customer = appt.customer;
            } else {
                continue; // provider-self placeholder / missing customer
            }

            if (!clientMap.has(key)) {
                clientMap.set(key, { customer, isWalkIn, visits: 0, totalSpend: 0, lastVisit: null, firstVisit: null, statuses: {} });
            }
            const c = clientMap.get(key);
            c.visits += 1;
            if (appt.status === 'completed') c.totalSpend += appt.totalPrice || 0;
            if (!c.lastVisit || new Date(appt.appointmentDate) > new Date(c.lastVisit)) c.lastVisit = appt.appointmentDate;
            if (!c.firstVisit || new Date(appt.appointmentDate) < new Date(c.firstVisit)) c.firstVisit = appt.appointmentDate;
            c.statuses[appt.status] = (c.statuses[appt.status] || 0) + 1;
        }

        // Notes only exist for registered clients (real ObjectId keys).
        const registeredIds = Array.from(clientMap.keys()).filter(k => !k.startsWith('walkin:'));
        const notes = await ClientNote.find({ provider: providerId, customer: { $in: registeredIds } });
        const noteMap = {};
        for (const n of notes) noteMap[n.customer.toString()] = n;

        const clients = Array.from(clientMap.values()).map(c => ({
            ...c,
            note: c.isWalkIn ? null : (noteMap[c.customer._id.toString()] || null),
        })).sort((a, b) => new Date(b.lastVisit) - new Date(a.lastVisit));

        res.status(200).json({ success: true, data: clients });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Get full appointment history for a specific client (for this provider)
exports.getClientDetail = async (req, res) => {
    try {
        const scope = await buildClientScope(req);
        if (scope.forbidden) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        if (scope.empty) return res.status(404).json({ success: false, message: 'Client not found' });
        const { providerId } = scope;
        const { customerId } = req.params;

        // Walk-in client (no account) — resolve by name; no notes.
        if (customerId.startsWith('walkin:')) {
            const name = customerId.slice('walkin:'.length).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const appointments = await Appointment.find({ ...scope.filter, walkInName: new RegExp(`^${name}$`, 'i') })
                .populate('service', 'name price duration')
                .sort({ appointmentDate: -1 });
            // Only when the scope is assignment-narrowed does "no rows" mean
            // "not one of their clients" — don't confirm the person exists. A
            // whole-business viewer (the owner) is not
            // narrowed, so it must not 404 here.
            if (!appointments.length && scope.assigned) {
                return res.status(404).json({ success: false, message: 'Client not found' });
            }
            return res.status(200).json({ success: true, data: { appointments, note: null } });
        }

        // The history and the CRM note are independent — fetch them together.
        const [appointments, note] = await Promise.all([
            Appointment.find({ ...scope.filter, customer: customerId })
                .populate('service', 'name price duration')
                .sort({ appointmentDate: -1 }),
            ClientNote.findOne({ provider: providerId, customer: customerId }),
        ]);

        // Same guard for registered clients: an assignment-scoped member may only
        // open a client they actually serve. The note is business-wide, so withhold
        // it (and the 200) rather than leak a colleague's client's CRM record.
        if (!appointments.length && scope.assigned) {
            return res.status(404).json({ success: false, message: 'Client not found' });
        }

        res.status(200).json({ success: true, data: { appointments, note: note || null } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Create or update CRM note for a client
exports.upsertClientNote = async (req, res) => {
    try {
        const scope = await buildClientScope(req);
        if (scope.forbidden) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        if (scope.empty) return res.status(404).json({ success: false, message: 'Client not found' });
        const { providerId } = scope;
        const { customerId } = req.params;
        const { notes, allergies, conditions, internalNotes, tags, birthday } = req.body;

        // Walk-ins have no account to attach a note to.
        if (customerId.startsWith('walkin:')) {
            return res.status(400).json({ success: false, message: 'Notes are only available for registered clients.' });
        }

        // A note may only be written about an actual client of THIS provider —
        // someone who has booked with them. Without this, any provider could
        // upsert a CRM record (allergies, conditions, internal notes, birthday)
        // keyed to an arbitrary user id for a stranger who never booked with them.
        if (!mongoose.isValidObjectId(customerId)) {
            return res.status(400).json({ success: false, message: 'Invalid client id' });
        }
        // Scope-narrowed, so for a staff member this ALSO enforces assignment: they
        // may only write a note about a client they personally serve.
        const isClient = await Appointment.exists({ ...scope.filter, customer: customerId });
        if (!isClient) {
            return res.status(404).json({ success: false, message: 'Client not found' });
        }

        const note = await ClientNote.findOneAndUpdate(
            { provider: providerId, customer: customerId },
            { notes, allergies, conditions, internalNotes, tags, birthday },
            { new: true, upsert: true, runValidators: true }
        );

        res.status(200).json({ success: true, data: note });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
