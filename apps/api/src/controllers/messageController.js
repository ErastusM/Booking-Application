const Message = require('../models/Message');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const { createNotification } = require('../utils/notificationhelper');
const { can } = require('../utils/permissions');

// The actor's role in an appointment's conversation, or null if they're not a
// party. A staff member of the appointment's OWN business (staffOf === provider)
// who holds clients:contact may join as 'staff' — and messages AS THEMSELVES
// (their own identity is the sender), talking to the client. The staffOf scope
// is the cross-tenant guard: a staff member can only reach their employer's
// appointments, never another business's.
const partyRole = (user, appointment) => {
    const uid = String(user._id);
    if (appointment.customer && String(appointment.customer) === uid) return 'customer';
    if (appointment.provider && String(appointment.provider) === uid) return 'provider';
    if (user.role === 'staff' && user.staffOf && appointment.provider
        && String(user.staffOf) === String(appointment.provider)
        && can(user, 'clients:contact')) return 'staff';
    return null;
};

// Get all conversations for the logged-in user (grouped by appointment)
exports.getMyConversations = async (req, res) => {
    try {
        const userId = req.user._id;

        // The conversation list is one row per appointment (the latest message),
        // plus the per-conversation unread counts. Loading the user's ENTIRE
        // message history with four joins each and de-duping in JS grew with inbox
        // size; instead aggregate the latest message id per appointment first, then
        // populate ONLY those rows. Unread counts come from a second grouped
        // aggregate (already replaced the old per-conversation countDocuments N+1).
        const [latest, unreadAgg] = await Promise.all([
            Message.aggregate([
                { $match: { $or: [{ sender: userId }, { recipient: userId }], appointment: { $ne: null } } },
                { $sort: { createdAt: -1 } },
                { $group: { _id: '$appointment', msgId: { $first: '$_id' } } },
            ]),
            Message.aggregate([
                { $match: { recipient: userId, readBy: { $ne: userId } } },
                { $group: { _id: '$appointment', count: { $sum: 1 } } },
            ]),
        ]);
        const messages = await Message.find({ _id: { $in: latest.map(l => l.msgId) } })
            .sort({ createdAt: -1 })
            .populate('sender', 'name avatar')
            .populate('recipient', 'name avatar')
            .populate({
                path: 'appointment',
                populate: [
                    { path: 'service', select: 'name' },
                    { path: 'customer', select: 'name avatar' },
                    { path: 'provider', select: 'name avatar' },
                ],
            });
        const unreadMap = new Map(unreadAgg.map(u => [String(u._id), u.count]));

        // Deduplicate by appointment, keep latest message per conversation
        const seen = new Set();
        const conversations = [];
        for (const msg of messages) {
            const apptId = msg.appointment?._id?.toString();
            if (!apptId || seen.has(apptId)) continue;
            seen.add(apptId);

            const otherId = msg.sender._id.toString() === userId.toString()
                ? msg.recipient._id
                : msg.sender._id;

            const unread = unreadMap.get(apptId) || 0;

            conversations.push({
                appointment: msg.appointment,
                lastMessage: { content: msg.content, createdAt: msg.createdAt, sender: msg.sender },
                otherId,
                unread,
            });
        }

        res.status(200).json({ success: true, data: conversations });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Get all messages for a specific appointment
exports.getMessages = async (req, res) => {
    try {
        const userId = req.user._id;
        const { appointmentId } = req.params;

        // Verify user is part of this appointment
        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });
        // customer / owner / an authorised staff member of this business may read
        // the appointment's thread. null-safe for guest bookings (customer null).
        if (!partyRole(req.user, appointment)) return res.status(403).json({ success: false, message: 'Not authorized' });

        const messages = await Message.find({ appointment: appointmentId })
            .populate('sender', 'name avatar')
            .sort({ createdAt: 1 });

        // Mark unread messages as read
        await Message.updateMany(
            { appointment: appointmentId, recipient: userId, readBy: { $ne: userId } },
            { $addToSet: { readBy: userId } }
        );

        res.status(200).json({ success: true, data: messages });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Send a message in an appointment conversation
exports.sendMessage = async (req, res) => {
    try {
        const userId = req.user._id;
        const { appointmentId } = req.params;
        const { content } = req.body;

        if (!content?.trim()) return res.status(400).json({ success: false, message: 'Message content is required' });
        if (content.trim().length > 2000) return res.status(400).json({ success: false, message: 'Message cannot exceed 2000 characters' });

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });

        const role = partyRole(req.user, appointment);
        if (!role) return res.status(403).json({ success: false, message: 'Not authorized' });

        // The customer talks to the business (owner); the owner and any staff
        // member talk to the customer. A staff member sends AS THEMSELVES — the
        // sender is their own user id — so the thread shows who actually replied.
        const recipientId = role === 'customer' ? appointment.provider : appointment.customer;
        if (!recipientId) return res.status(400).json({ success: false, message: 'No recipient found for this appointment' });

        // Block check — no messaging in either direction once someone has blocked.
        // For a STAFF sender we also honour a block between the client and the
        // BUSINESS OWNER: blocking the business blocks its staff too (and vice
        // versa), so a client can't be reached by staff after blocking the owner.
        const pairs = role === 'staff'
            ? [[userId, recipientId], [appointment.provider, appointment.customer]]
            : [[userId, recipientId]];
        const ids = [...new Set(pairs.flat().filter(Boolean).map(String))];
        const docs = await User.find({ _id: { $in: ids } }).select('blockedUsers');
        const blockMap = new Map(docs.map((d) => [String(d._id), (d.blockedUsers || []).map(String)]));
        const blockedBetween = (a, b) => (blockMap.get(String(a)) || []).includes(String(b))
            || (blockMap.get(String(b)) || []).includes(String(a));
        if (pairs.some(([a, b]) => a && b && blockedBetween(a, b))) {
            return res.status(403).json({ success: false, message: 'Messaging is unavailable between you and this user.' });
        }

        const message = await Message.create({
            sender: userId,
            recipient: recipientId,
            appointment: appointmentId,
            content: content.trim(),
            readBy: [userId],
        });

        await message.populate('sender', 'name avatar');

        // Notify the recipient
        const senderIsCustomer = appointment.customer.toString() === userId.toString();
        const notifLink = senderIsCustomer ? '/dashboard' : '/appointments';
        const preview = content.trim().length > 80 ? content.trim().substring(0, 80) + '…' : content.trim();
        try {
            await createNotification(recipientId, `New message from ${req.user.name}: "${preview}"`, 'message', notifLink);
        } catch (_) {}

        res.status(201).json({ success: true, data: message });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Get unread message count
exports.getUnreadCount = async (req, res) => {
    try {
        const count = await Message.countDocuments({
            recipient: req.user._id,
            readBy: { $ne: req.user._id },
        });
        res.status(200).json({ success: true, data: { count } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
