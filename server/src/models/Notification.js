const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        type: {
            type: String,
            enum: ['appointment', 'waiting_list', 'general', 'system', 'wallet'],
            default: 'general',
        },
        read: {
            type: Boolean,
            default: false,
        },
        link: {
            type: String,
            default: '',
        },
    },
    { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, read: 1 });

module.exports = mongoose.model('Notification', notificationSchema);