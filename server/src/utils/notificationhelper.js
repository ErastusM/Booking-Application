const Notification = require('../models/Notification');
const pushService = require('./pushService');

exports.createNotification = async (userId, message, type = 'general', link = '') => {
    try {
        await Notification.create({ user: userId, message, type, link });
        // Fire a web push too — no-op unless VAPID is configured
        pushService.sendToUser(userId, { title: 'Bookplus', body: message, url: link || '/' });
    } catch (error) {
        console.error('Failed to create notification:', error.message);
    }
};

// Notify every admin user — used for system-level alerts (new signups, new bookings, etc.)
exports.notifyAdmins = async (message, type = 'system', link = '') => {
    try {
        const User = require('../models/User');
        const admins = await User.find({ role: 'admin' }).select('_id');
        if (!admins.length) return;
        const docs = admins.map((a) => ({ user: a._id, message, type, link }));
        await Notification.insertMany(docs);
    } catch (error) {
        console.error('Failed to notify admins:', error.message);
    }
};