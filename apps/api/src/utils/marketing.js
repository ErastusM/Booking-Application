/**
 * Marketing email consent (compliance audit point 11).
 *
 * Promotional email — today the "Book again" rebooking prompt — goes ONLY to
 * people who opted in:
 *   - account holders: User.marketingEmails.optIn (unticked at sign-up, toggle
 *     in account settings);
 *   - guests without an account: the box they ticked on that booking
 *     (Appointment.guestMarketing.optIn).
 * Every marketing email carries a one-click unsubscribe link (a signed token,
 * no login) plus List-Unsubscribe / List-Unsubscribe-Post headers (RFC 8058).
 *
 * Transactional email (confirmations, reminders, receipts, password, invites)
 * is not marketing and is unaffected by any of this.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');

// Keys for unsubscribe links (a dedicated key either way, so an unsubscribe
// token can never be replayed as anything else):
//  - UNSUBSCRIBE_KEY (32 bytes as hex) signs and checks links. Unset, a key
//    derived from JWT_SECRET is used, as it was before this setting existed.
//  - UNSUBSCRIBE_KEY_LEGACY is the derived key from before JWT_SECRET was
//    rotated (docs/ROTATING_SECRETS.md). Links emailed earlier never expire, so
//    they keep working, but only to unsubscribe: the old JWT_SECRET may be
//    public, so anyone could mint such a link, and it must never switch email
//    back on.
const HEX_KEY = /^[0-9a-f]{64}$/i;
const hexKey = (raw) => (HEX_KEY.test(raw || '') ? Buffer.from(raw, 'hex') : null);
const derivedKey = () => crypto.createHash('sha256').update(`bookplus-unsubscribe:${process.env.JWT_SECRET || ''}`).digest();
const unsubscribeKey = () => hexKey(process.env.UNSUBSCRIBE_KEY) || derivedKey();
const legacyKey = () => hexKey(process.env.UNSUBSCRIBE_KEY_LEGACY);
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (k, body) => b64(crypto.createHmac('sha256', k).update(body).digest()).slice(0, 32);
// Compared as bytes: a signature with non-ASCII characters is simply wrong.
const signedWith = (k, body, sig) => {
    const given = Buffer.from(sig);
    const expected = Buffer.from(sign(k, body));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

/**
 * Token for one recipient: { k:'u', id } for an account, { k:'g', e } for a
 * guest email. It does not expire — an unsubscribe link must keep working.
 */
const makeUnsubscribeToken = (subject) => {
    const payload = subject.userId ? { k: 'u', id: String(subject.userId) } : { k: 'g', e: String(subject.email || '').toLowerCase() };
    const body = b64(JSON.stringify(payload));
    return `${body}.${sign(unsubscribeKey(), body)}`;
};

/**
 * The recipient a token names, or null. `optOut: true` (unsubscribing) also
 * accepts links signed with UNSUBSCRIBE_KEY_LEGACY, and marks them `legacy`.
 */
const readUnsubscribeToken = (token, { optOut = false } = {}) => {
    if (typeof token !== 'string' || token.length > 600) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    let legacy = false;
    if (!signedWith(unsubscribeKey(), body, sig)) {
        const old = optOut ? legacyKey() : null;
        if (!old || !signedWith(old, body, sig)) return null;
        legacy = true;
    }
    try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        const mark = legacy ? { legacy: true } : {};
        if (p.k === 'u' && mongoose.isValidObjectId(p.id)) return { userId: p.id, ...mark };
        if (p.k === 'g' && typeof p.e === 'string' && p.e.includes('@')) return { email: p.e, ...mark };
    } catch { /* fall through */ }
    return null;
};

/** Append a consent change to a user's audit log (kept, capped at 50). */
const consentLogEntry = (kind, value, source) => ({ kind, value, source, at: new Date() });

/**
 * Who, if anyone, may receive a MARKETING email about this appointment.
 * Returns { email, name, unsubscribeToken } or null. `appt.customer` must be
 * populated with email + marketingEmails when it is a registered client.
 */
const marketingRecipientFor = (appt) => {
    if (!appt) return null;
    const c = appt.customer;
    if (c && c._id) {
        if (!c.email || c.deletedAt || !(c.marketingEmails && c.marketingEmails.optIn === true)) return null;
        return { email: c.email, name: c.name, unsubscribeToken: makeUnsubscribeToken({ userId: c._id }) };
    }
    if (appt.guestEmail && appt.guestMarketing && appt.guestMarketing.optIn === true) {
        return { email: appt.guestEmail, name: appt.guestName, unsubscribeToken: makeUnsubscribeToken({ email: appt.guestEmail }) };
    }
    return null;
};

/**
 * Apply an unsubscribe (or resubscribe) for a verified token subject.
 * Returns { ok, kind } — never reveals more than that.
 */
const setMarketingFromToken = async (subject, optIn, source = 'unsubscribe_link') => {
    const User = require('../models/User');
    const Appointment = require('../models/Appointment');
    const at = new Date();
    if (subject.userId) {
        // Undo ("I clicked by mistake") may only restore an opt-in the person gave
        // themselves — the account's consent log must show one. Mirrors the guest
        // everOptedIn rule: a link can never opt someone IN who never opted in.
        const filter = { _id: subject.userId, deletedAt: null };
        if (optIn) filter.$or = [
            { consentLog: { $elemMatch: { kind: 'marketing_emails', value: true } } },
            { 'marketingEmails.optIn': true },
        ];
        if (optIn && !(await User.exists(filter))) {
            return { ok: false, reason: 'never_opted_in', kind: 'account' };
        }
        const r = await User.updateOne(
            filter,
            {
                $set: { marketingEmails: { optIn, at, source } },
                $push: { consentLog: { $each: [consentLogEntry('marketing_emails', optIn, source)], $slice: -50 } },
            },
        );
        return { ok: r.matchedCount > 0, kind: 'account' };
    }
    if (subject.email) {
        // A guest's choice lives on their bookings; unsubscribing covers every one.
        // Undoing it ("I clicked by mistake") only re-enables bookings where they
        // had ticked the box themselves — it can never opt a booking in that
        // they never opted in on.
        const filter = optIn
            ? { guestEmail: subject.email, 'guestMarketing.everOptedIn': true }
            : { guestEmail: subject.email };
        if (optIn && !(await Appointment.exists(filter))) {
            return { ok: false, reason: 'never_opted_in', kind: 'guest' };
        }
        await Appointment.updateMany(filter, {
            $set: { 'guestMarketing.optIn': optIn, 'guestMarketing.at': at, 'guestMarketing.source': source },
        });
        return { ok: true, kind: 'guest' };
    }
    return { ok: false };
};

module.exports = {
    unsubscribeKey,
    derivedKey,
    makeUnsubscribeToken,
    readUnsubscribeToken,
    marketingRecipientFor,
    setMarketingFromToken,
    consentLogEntry,
};
