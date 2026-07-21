const Notification = require('../models/Notification');

exports.getMyNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .limit(20);

        const unreadCount = await Notification.countDocuments({
            user: req.user._id,
            read: false,
        });

        res.status(200).json({ success: true, unreadCount, data: notifications });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.markAllRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { user: req.user._id, read: false },
            { read: true }
        );
        res.status(200).json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.markOneRead = async (req, res) => {
    try {
        // Scope by owner. Matching only on the id (findByIdAndUpdate) let any
        // authenticated user flip another tenant's notification to read via its
        // id (IDOR) — every sibling handler here already scopes on req.user._id.
        await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { read: true }
        );
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        // Scope by owner. Matching only on the id (findByIdAndDelete) let any
        // authenticated user destroy another tenant's notification via its id
        // (IDOR) — every sibling handler here already scopes on req.user._id.
        await Notification.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};