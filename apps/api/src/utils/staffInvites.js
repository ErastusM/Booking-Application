/**
 * Staff set-password invites.
 *
 * Invites used to live in the single passwordResetToken slot, so every Resend
 * (and the member's own "Forgot password?") overwrote it and silently killed
 * every earlier email — including the one the member had open. Invites now live
 * in User.staffInvites: one entry per email sent, each valid for 7 days until
 * ANY of them is accepted. passwordResetToken is still read as a fallback so
 * invite emails sent before this shipped keep working.
 *
 * Only the SHA-256 hash of a token is ever stored.
 */
const crypto = require('crypto');
const User = require('../models/User');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INVITES = 10;
// An owner double-tapping Send/Resend (or two owners) within this window gets
// the same answer and no second email.
const OWNER_RESEND_THROTTLE_MS = 60 * 1000;
// Member-initiated sends (renew / request / forgot-password): per account.
const SELF_COOLDOWN_MS = 2 * 60 * 1000;
const SELF_DAILY_MAX = 5;

const INVITE_MESSAGE = 'This invite link is invalid or has expired.';

// Every field an invite lookup may need, in one projection.
const INVITE_SELECT = '+staffInvites +password +passwordResetToken +passwordResetExpiry '
    + 'name email role staffOf lastLoginAt isActive deactivatedAt providerCategory avatar phone '
    + 'providerSetupComplete tokenVersion staffTier staffPermissions provider';

const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

const byNewest = (a, b) => new Date(b.sentAt) - new Date(a.sentAt);

/** The most recently sent invite entry, or null. */
const latestInvite = (user) => {
    const list = (user && user.staffInvites) || [];
    return list.length ? [...list].sort(byNewest)[0] : null;
};

/** True when an invite for this account is still waiting to be accepted. */
const hasOpenInvite = (user, now = Date.now()) => ((user && user.staffInvites) || [])
    .some((e) => !e.usedAt && !e.retiredAt && new Date(e.expiresAt).getTime() > now);

/**
 * Push a fresh invite onto the user (in memory — caller saves, then calls
 * trimInvites). A plain push saves as an atomic $push, so it can't overwrite an
 * accept that lands between this document's load and its save (a whole-array
 * $set would quietly un-use the accepted invite). Returns the raw token.
 */
const mintInvite = (user, now = new Date()) => {
    const raw = crypto.randomBytes(32).toString('hex');
    const entry = {
        hash: hashToken(raw),
        sentAt: now,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        usedAt: null,
        retiredAt: null,
        emailed: false,
    };
    if (Array.isArray(user.staffInvites)) user.staffInvites.push(entry);
    else user.staffInvites = [entry];
    return { raw, entry };
};

/** Keep only the newest MAX_INVITES entries (atomic; no-op below the cap). */
const trimInvites = (userId) => User.updateOne(
    { _id: userId, [`staffInvites.${MAX_INVITES}`]: { $exists: true } },
    { $push: { staffInvites: { $each: [], $slice: -MAX_INVITES } } },
);

/** Atomically retire every open invite except `keepHash` (the one just accepted). */
const retireOthersAtomic = (userId, keepHash, now = new Date()) => User.updateOne(
    { _id: userId, staffInvites: { $type: 'array' } },   // legacy-only accounts have none
    { $set: { 'staffInvites.$[o].retiredAt': now } },
    { arrayFilters: [{ 'o.usedAt': null, 'o.retiredAt': null, 'o.hash': { $ne: keepHash } }] },
);

/**
 * Retire every still-open invite (in memory — caller saves). With
 * `{ includeUsed: true }` the used one is retired too, which starts a fresh
 * round: a member re-invited after an archive can accept again.
 */
const retireOpenInvites = (user, now = new Date(), { includeUsed = false } = {}) => {
    let changed = false;
    for (const e of user.staffInvites || []) {
        if (!e.retiredAt && (includeUsed || !e.usedAt)) { e.retiredAt = now; changed = true; }
    }
    if (changed) user.markModified('staffInvites');
};

/** What the owner's Team card shows for a pending member (null once accepted). */
const inviteSummary = (user) => {
    if (!user || user.lastLoginAt) return null;
    const latest = latestInvite(user);
    if (latest) return { inviteSentAt: latest.sentAt, inviteExpiresAt: latest.expiresAt };
    // An invite emailed before staffInvites existed lives in the legacy slot.
    if (user.passwordResetToken && user.passwordResetExpiry) {
        const exp = new Date(user.passwordResetExpiry);
        return { inviteSentAt: new Date(exp.getTime() - INVITE_TTL_MS), inviteExpiresAt: exp };
    }
    return null;
};

/**
 * Resolve a raw invite token to { user, entry, legacy, code, newerSentAt }.
 * code is null for a usable invite, else one of INVITE_EXPIRED |
 * INVITE_SUPERSEDED | INVITE_ACCEPTED | INVITE_REVOKED | INVITE_INVALID.
 */
const resolveInvite = async (raw) => {
    if (!raw || typeof raw !== 'string' || raw.length > 256) return { code: 'INVITE_INVALID' };
    const hash = hashToken(raw);
    let legacy = false;
    let entry = null;
    let user = await User.findOne({ role: 'staff', 'staffInvites.hash': hash }).select(INVITE_SELECT);
    if (user) {
        entry = user.staffInvites.find((e) => e.hash === hash);
    } else {
        user = await User.findOne({ role: 'staff', passwordResetToken: hash }).select(INVITE_SELECT);
        if (!user) return { code: 'INVITE_INVALID' };
        legacy = true;
        entry = { hash, sentAt: null, expiresAt: user.passwordResetExpiry, usedAt: null, retiredAt: null };
    }
    const base = { user, entry, legacy, hash };

    // Archived / removed from the business: terminal until the owner re-invites.
    if (!user.staffOf) return { ...base, code: 'INVITE_REVOKED' };

    const invites = user.staffInvites || [];
    if (entry.usedAt) return { ...base, code: 'INVITE_ACCEPTED' };
    if (entry.retiredAt) {
        // Retired because a sibling invite was accepted → they're set up.
        // Retired for any other reason (re-invited after an archive) → revoked.
        const accepted = invites.some((e) => e.usedAt && new Date(e.usedAt) >= new Date(entry.sentAt || 0));
        return { ...base, code: accepted ? 'INVITE_ACCEPTED' : 'INVITE_REVOKED' };
    }
    if (!entry.expiresAt || new Date(entry.expiresAt).getTime() <= Date.now()) {
        const newer = invites
            .filter((e) => e.hash !== hash && (!entry.sentAt || new Date(e.sentAt) > new Date(entry.sentAt)))
            .sort(byNewest)[0];
        if (newer) return { ...base, code: 'INVITE_SUPERSEDED', newerSentAt: newer.sentAt };
        return { ...base, code: 'INVITE_EXPIRED' };
    }
    return { ...base, code: null };
};

/**
 * Atomically reserve one member-initiated send for this account: at most one per
 * SELF_COOLDOWN_MS (counting the owner's own latest send too) and SELF_DAILY_MAX
 * per 24h. Returns false when the send must be skipped (silently), else
 * { earlierToday } — the member-initiated sends in the previous 24h.
 */
const claimSelfServiceSlot = async (user) => {
    const now = new Date();
    const cool = new Date(now.getTime() - SELF_COOLDOWN_MS);
    const latest = latestInvite(user);
    if (latest && new Date(latest.sentAt) > cool) return false;
    const fresh = await User.findById(user._id).select('+inviteRequestLog');
    const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
    const recent = ((fresh && fresh.inviteRequestLog) || []).filter((d) => new Date(d).getTime() > dayAgo);
    if (recent.length >= SELF_DAILY_MAX) return false;
    const r = await User.updateOne(
        { _id: user._id, inviteRequestLog: { $not: { $gt: cool } } },
        { $push: { inviteRequestLog: { $each: [now], $slice: -MAX_INVITES } } },
    );
    if (r.modifiedCount !== 1) return false;
    // How many member-initiated sends this account had in the 24h before this one.
    return { earlierToday: recent.length };
};

const businessNameFor = (owner) => (owner && (owner.businessProfile?.businessName || owner.name)) || 'the team';

/**
 * A member asked for a new link (expired page, "Forgot password?", or the
 * email box). Never throws; the caller has already answered the request with
 * the same generic response whatever happens here.
 *  - pending staff (no password yet, or an invite still open) → fresh invite
 *    to the address on file + a receipt to the owner
 *  - active staff → a normal password-reset (sign-in) email
 *  - anything else (unknown, archived, suspended, not staff) → nothing
 */
const selfServiceSend = async (userOrId) => {
    try {
        if (!userOrId) return 'skipped';
        // Always reload with the full invite projection: minting onto a document
        // loaded WITHOUT staffInvites would overwrite the array and kill every
        // earlier invite — the exact bug this module exists to fix.
        const user = await User.findById(userOrId._id || userOrId).select(INVITE_SELECT);
        if (!user || user.role !== 'staff' || !user.staffOf) return 'skipped';
        if (user.isActive === false && !user.deactivatedAt) return 'skipped'; // admin suspension
        const slot = await claimSelfServiceSlot(user);
        if (!slot) return 'throttled';
        const email = require('./emailService');
        const pending = !user.password || hasOpenInvite(user);
        if (pending) {
            const { raw } = mintInvite(user);
            await user.save({ validateBeforeSave: false });
            await trimInvites(user._id);
            const owner = await User.findById(user.staffOf).select('name email businessProfile');
            const businessName = businessNameFor(owner);
            Promise.resolve(email.sendStaffInviteEmail(user.email, user.name, businessName, raw)).catch(() => {});
            // The owner hears about it once a day per member at most: these
            // endpoints are public, so a stranger replaying them must not be able
            // to fill the owner's inbox (the member's own inbox is capped at 5/day).
            if (owner && slot.earlierToday === 0 && typeof email.sendStaffInviteOwnerReceipt === 'function') {
                Promise.resolve(email.sendStaffInviteOwnerReceipt(owner.email, user.name, user.email, businessName, { requestedByMember: true }))
                    .catch(() => {});
            }
            return 'invite';
        }
        const raw = crypto.randomBytes(32).toString('hex');
        user.passwordResetToken = hashToken(raw);
        user.passwordResetExpiry = new Date(Date.now() + 60 * 60 * 1000);
        await user.save({ validateBeforeSave: false });
        Promise.resolve(email.sendPasswordResetEmail(user.email, user.name, raw, user.role)).catch(() => {});
        return 'reset';
    } catch (err) {
        return 'error';
    }
};

module.exports = {
    INVITE_TTL_MS,
    MAX_INVITES,
    OWNER_RESEND_THROTTLE_MS,
    SELF_COOLDOWN_MS,
    SELF_DAILY_MAX,
    INVITE_MESSAGE,
    INVITE_SELECT,
    hashToken,
    latestInvite,
    hasOpenInvite,
    mintInvite,
    trimInvites,
    retireOthersAtomic,
    retireOpenInvites,
    inviteSummary,
    resolveInvite,
    claimSelfServiceSlot,
    selfServiceSend,
    businessNameFor,
};
