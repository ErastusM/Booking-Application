const mongoose = require('mongoose');
const { RETENTION } = require('../constants/retention');

/**
 * A first-time "Continue with Google" sign-in that has NOT become an account yet.
 * Google has proved who the person is, but the account is only created once they
 * have seen and accepted the Terms and Privacy Policy and confirmed their age on
 * the "Finish signing up" step (POST /api/auth/google/complete). Until then the
 * Google profile waits here, reachable only through the one-time code in the
 * redirect, and disappears by itself (TTL) if they walk away.
 */
const pendingSignupSchema = new mongoose.Schema({
    codeHash: { type: String, default: null, index: true },
    googleId: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: '' },
    avatar: { type: String, default: null },
    role: { type: String, enum: ['customer', 'provider'], default: 'customer' },
    expiresAt: { type: Date, required: true },
}, { timestamps: true });

pendingSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

pendingSignupSchema.statics.TTL_MS = RETENTION.PENDING_SIGNUP_MINUTES * 60 * 1000;

module.exports = mongoose.model('PendingSignup', pendingSignupSchema);
