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

// A dedicated key derived from JWT_SECRET, so no new secret has to be configured
// and an unsubscribe token can never be replayed as anything else.
const key = () => crypto.createHash('sha256').update(`bookplus-unsubscribe:${process.env.JWT_SECRET || ''}`).digest();
const b64 = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Token for one recipient: { k:'u', id } for an account, { k:'g', e } for a
 * guest email. It does not expire — an unsubscribe link must keep working.
 */
const makeUnsubscribeToken = (subject) => {
    const payload = subject.userId ? { k: 'u', id: String(subject.userId) } : { k: 'g', e: String(subject.email || '').toLowerCase() };
    const body = b64(JSON.stringify(payload));
    const sig = b64(crypto.createHmac('sha256', key()).update(body).digest()).slice(0, 32);
    return `${body}.${sig}`;
};

const readUnsubscribeToken = (token) => {
    if (typeof token !== 'string' || token.length > 600) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = b64(crypto.createHmac('sha256', key()).update(body).digest()).slice(0, 32);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (p.k === 'u' && mongoose.isValidObjectId(p.id)) return { userId: p.id };
        if (p.k === 'g' && typeof p.e === 'string' && p.e.includes('@')) return { email: p.e };
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
    makeUnsubscribeToken,
    readUnsubscribeToken,
    marketingRecipientFor,
    setMarketingFromToken,
    consentLogEntry,
};
