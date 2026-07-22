const mongoose = require('mongoose');

// One row per device that can receive a notification for a user.
//
// Web (PWA): `endpoint` is the browser push-service URL and `keys` holds the
// Web Push encryption keys. Native (Ionic/Capacitor): there is no web endpoint
// or keys — instead `platform` is 'ios'/'android' and `deviceToken` is the
// APNs/FCM token. To keep ONE unique identity (and avoid an index migration on
// the live collection), native rows reuse `endpoint` as a synthetic key:
// `native:<platform>:<deviceToken>`. So `endpoint` stays unique+required for
// both; `keys` is only present for web.
const pushSubscriptionSchema = new mongoose.Schema({
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    // Web Push encryption keys — present for web subscriptions, absent for native.
    keys: {
        p256dh: { type: String },
        auth:   { type: String },
    },
    // 'web' (default, back-compat with existing rows that predate this field),
    // or 'ios' / 'android' for a native Capacitor device token.
    platform:    { type: String, enum: ['web', 'ios', 'android'], default: 'web' },
    // Raw APNs/FCM device token for native rows (used by the future native sender).
    deviceToken: { type: String },
    userAgent:   { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
