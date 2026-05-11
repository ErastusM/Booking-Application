const Notification = require('../models/Notification');

exports.createNotification = async (userId, message, type = 'general', link = '') => {
    try {
        await Notification.create({ user: userId, message, type, link });
    } catch (error) {
        console.error('Failed to create notification:', error.message);
    }
};