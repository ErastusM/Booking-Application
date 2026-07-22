const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let webpush = null;
let configured = false;

// Configure web-push only when VAPID keys are present. Without them the
// whole module is a safe no-op — nothing is sent in dev/test by default.
try {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (pub && priv) {
        webpush = require('web-push');
        webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || 'mailto:notifications@bookplus.pro',
            pub,
            priv
        );
        configured = true;
        logger.info('Web Push configured');
    } else {
        logger.info('Web Push not configured (VAPID_* env vars absent) — push disabled');
    }
} catch (err) {
    logger.warn({ err }, 'Web Push setup failed — push disabled');
}

exports.isConfigured = () => configured;
exports.getPublicKey = () => process.env.VAPID_PUBLIC_KEY || null;

/**
 * Send a push to every subscription owned by a user. No-op when push is
 * not configured. Stale (410/404) subscriptions are pruned automatically.
 */
exports.sendToUser = async (userId, payload) => {
    if (!configured || !webpush) return;
    try {
        const PushSubscription = require('../models/PushSubscription');
        // Only WEB Push-capable rows (those carrying encryption keys). Native
        // Capacitor device tokens live in the same collection but have no keys and
        // are delivered by the native sender (future ticket), not web-push. The
        // keys.auth check also covers legacy rows that predate the `platform` field.
        const subs = await PushSubscription.find({ user: userId, 'keys.auth': { $exists: true } });
        if (!subs.length) return;
        const body = JSON.stringify({
            title: payload.title || 'Bookplus',
            body: payload.body || '',
            url: payload.url || '/',
        });
        await Promise.all(subs.map(async (sub) => {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: sub.keys },
                    body
                );
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await PushSubscription.deleteOne({ _id: sub._id });
                } else {
                    logger.warn({ err: err.message }, 'Push send failed');
                }
            }
        }));
    } catch (err) {
        logger.error({ err }, 'sendToUser failed');
    }
};
