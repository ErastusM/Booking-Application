const PushSubscription = require('../models/PushSubscription');
const pushService = require('../utils/pushService');

// Public key + whether push is enabled on this server
exports.getPublicKey = (req, res) => {
    res.status(200).json({
        success: true,
        enabled: pushService.isConfigured(),
        publicKey: pushService.getPublicKey(),
    });
};

// Save (or refresh) a subscription for the current user
exports.subscribe = async (req, res) => {
    try {
        const { endpoint, keys } = req.body || {};
        if (!endpoint || !keys?.p256dh || !keys?.auth) {
            return res.status(400).json({ success: false, message: 'Invalid subscription' });
        }
        await PushSubscription.findOneAndUpdate(
            { endpoint },
            { user: req.user._id, endpoint, keys, userAgent: req.headers['user-agent'] || '' },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Remove a subscription
exports.unsubscribe = async (req, res) => {
    try {
        const { endpoint } = req.body || {};
        if (endpoint) await PushSubscription.deleteOne({ endpoint, user: req.user._id });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
