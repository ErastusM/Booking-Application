const Appointment = require('../models/Appointment');
const ClientNote = require('../models/ClientNote');

// Get all unique clients who have booked with this provider
exports.getMyClients = async (req, res) => {
    try {
        const providerId = req.user._id;

        const appointments = await Appointment.find({ provider: providerId })
            .populate('customer', 'name email phone createdAt')
            .populate('service', 'name price')
            .sort({ appointmentDate: -1 });

        // Group by customer
        const clientMap = new Map();
        for (const appt of appointments) {
            if (!appt.customer) continue;
            const cid = appt.customer._id.toString();
            if (!clientMap.has(cid)) {
                clientMap.set(cid, {
                    customer: appt.customer,
                    visits: 0,
                    totalSpend: 0,
                    lastVisit: null,
                    firstVisit: null,
                    statuses: {},
                });
            }
            const c = clientMap.get(cid);
            c.visits += 1;
            if (appt.status === 'completed') c.totalSpend += appt.totalPrice || 0;
            if (!c.lastVisit || new Date(appt.appointmentDate) > new Date(c.lastVisit)) {
                c.lastVisit = appt.appointmentDate;
            }
            if (!c.firstVisit || new Date(appt.appointmentDate) < new Date(c.firstVisit)) {
                c.firstVisit = appt.appointmentDate;
            }
            c.statuses[appt.status] = (c.statuses[appt.status] || 0) + 1;
        }

        // Fetch notes for these clients
        const clientIds = Array.from(clientMap.keys());
        const notes = await ClientNote.find({ provider: providerId, customer: { $in: clientIds } });
        const noteMap = {};
        for (const n of notes) noteMap[n.customer.toString()] = n;

        const clients = Array.from(clientMap.values()).map(c => ({
            ...c,
            note: noteMap[c.customer._id.toString()] || null,
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

        const appointments = await Appointment.find({ provider: providerId, customer: customerId })
            .populate('service', 'name price duration')
            .sort({ appointmentDate: -1 });

        const note = await ClientNote.findOne({ provider: providerId, customer: customerId });

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
