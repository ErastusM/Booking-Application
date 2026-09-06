const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const ClientNote = require('../models/ClientNote');

// Get all unique clients who have used this provider's services — registered
// customers (booked online) AND walk-ins logged by the provider. A walk-in has
// no account, so its appointment carries the provider's own id as `customer`
// plus a `walkInName`; we surface those as their own clients (keyed by name)
// instead of lumping them under the provider.
exports.getMyClients = async (req, res) => {
    try {
        const providerId = req.user._id;
        const providerIdStr = providerId.toString();

        const appointments = await Appointment.find({ provider: providerId })
            .populate('customer', 'name email phone createdAt')
            .populate('service', 'name price')
            .sort({ appointmentDate: -1 });

        const clientMap = new Map();
        for (const appt of appointments) {
            let key, customer, isWalkIn = false;
            if (appt.walkInName && appt.walkInName.trim()) {
                const name = appt.walkInName.trim();
                key = `walkin:${name.toLowerCase()}`;
                customer = { _id: key, name, email: null, phone: null, isWalkIn: true };
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
        const providerId = req.user._id;
        const { customerId } = req.params;

        // Walk-in client (no account) — resolve by name; no notes.
        if (customerId.startsWith('walkin:')) {
            const name = customerId.slice('walkin:'.length).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const appointments = await Appointment.find({ provider: providerId, walkInName: new RegExp(`^${name}$`, 'i') })
                .populate('service', 'name price duration')
                .sort({ appointmentDate: -1 });
            return res.status(200).json({ success: true, data: { appointments, note: null } });
        }

        // The history and the CRM note are independent — fetch them together.
        const [appointments, note] = await Promise.all([
            Appointment.find({ provider: providerId, customer: customerId })
                .populate('service', 'name price duration')
                .sort({ appointmentDate: -1 }),
            ClientNote.findOne({ provider: providerId, customer: customerId }),
        ]);

        res.status(200).json({ success: true, data: { appointments, note: note || null } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Create or update CRM note for a client
exports.upsertClientNote = async (req, res) => {
    try {
        const providerId = req.user._id;
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
        const isClient = await Appointment.exists({ provider: providerId, customer: customerId });
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
