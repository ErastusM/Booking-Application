const Message = require('../models/Message');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const { createNotification } = require('../utils/notificationhelper');

// Get all conversations for the logged-in user (grouped by appointment)
exports.getMyConversations = async (req, res) => {
    try {
        const userId = req.user._id;

        // Find all appointments the user is part of that have at least one message,
        // and the per-conversation unread counts, together. The unread count used to
        // be a countDocuments PER conversation inside the loop below (an N+1 that
        // grew with the user's inbox); one grouped aggregate replaces all of them.
        const [messages, unreadAgg] = await Promise.all([
            Message.find({
                $or: [{ sender: userId }, { recipient: userId }],
            })
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
                }),
            Message.aggregate([
                { $match: { recipient: userId, readBy: { $ne: userId } } },
                { $group: { _id: '$appointment', count: { $sum: 1 } } },
            ]),
        ]);
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
        const isParty = appointment.customer.toString() === userId.toString() ||
            appointment.provider?.toString() === userId.toString();
        if (!isParty) return res.status(403).json({ success: false, message: 'Not authorized' });

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

        // Null-safe: a guest booking has no `customer` account, so `customer` is
        // null. A bare `.toString()` here 500'd on any message attempt against a
        // guest appointment. The optional chaining makes the customer side simply
        // not match (a guest can't be the authenticated sender anyway), and a
        // provider messaging a guest falls through to the "no recipient" 400 below.
        const isCustomerParty = appointment.customer?.toString() === userId.toString();
        const isParty = isCustomerParty || appointment.provider?.toString() === userId.toString();
        if (!isParty) return res.status(403).json({ success: false, message: 'Not authorized' });

        // Determine recipient
        const recipientId = isCustomerParty ? appointment.provider : appointment.customer;

        if (!recipientId) return res.status(400).json({ success: false, message: 'No recipient found for this appointment' });

        // Block check — no messaging in either direction once someone has blocked.
        const [meDoc, recipDoc] = await Promise.all([
            User.findById(userId).select('blockedUsers'),
            User.findById(recipientId).select('blockedUsers'),
        ]);
        const isBlocked = (meDoc?.blockedUsers || []).map(String).includes(recipientId.toString())
            || (recipDoc?.blockedUsers || []).map(String).includes(userId.toString());
        if (isBlocked) return res.status(403).json({ success: false, message: 'Messaging is unavailable between you and this user.' });

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
