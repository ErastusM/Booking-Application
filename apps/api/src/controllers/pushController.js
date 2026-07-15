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

// Save (or refresh) a subscription for the current user.
// Accepts EITHER a web push subscription { endpoint, keys } OR a native
// Capacitor device token { platform: 'ios'|'android', deviceToken }. Native rows
// reuse `endpoint` as a synthetic unique key so both share one identity + index.
exports.subscribe = async (req, res) => {
    try {
        const { endpoint, keys, platform, deviceToken } = req.body || {};
        const userAgent = req.headers['user-agent'] || '';

        // Native device token (Ionic/Capacitor).
        if (platform === 'ios' || platform === 'android') {
            if (!deviceToken || typeof deviceToken !== 'string') {
                return res.status(400).json({ success: false, message: 'Invalid device token' });
            }
            const nativeEndpoint = `native:${platform}:${deviceToken}`;
            await PushSubscription.findOneAndUpdate(
                { endpoint: nativeEndpoint },
                { user: req.user._id, endpoint: nativeEndpoint, platform, deviceToken, userAgent },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            return res.status(201).json({ success: true });
        }

        // Web push subscription (PWA).
        if (!endpoint || !keys?.p256dh || !keys?.auth) {
            return res.status(400).json({ success: false, message: 'Invalid subscription' });
        }
        await PushSubscription.findOneAndUpdate(
            { endpoint },
            { user: req.user._id, endpoint, keys, platform: 'web', userAgent },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Remove a subscription (web endpoint or native token).
exports.unsubscribe = async (req, res) => {
    try {
        const { endpoint, platform, deviceToken } = req.body || {};
        if ((platform === 'ios' || platform === 'android') && deviceToken) {
            await PushSubscription.deleteOne({ endpoint: `native:${platform}:${deviceToken}`, user: req.user._id });
        } else if (endpoint) {
            await PushSubscription.deleteOne({ endpoint, user: req.user._id });
        }
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
