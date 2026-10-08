// A "new client" booked from the business's New Appointment window: a person
// with no account, saved by name like a walk-in, but with the phone number (and
// optionally the email) the business typed in, so the client shows up in My
// Clients with a way to reach them and gets the confirmation and reminders.
//
// A plain Guest (name only) never sends newClient, and keeps storing no contact
// details at all.
const { isFullName } = require('./personName');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Digits, spaces and the usual phone punctuation, with at least 7 digits.
const validPhone = (phone) => /^[+\d\s\-()]{7,20}$/.test(phone) && (phone.match(/\d/g) || []).length >= 7;

/**
 * Reads { newClient, walkInName, guestPhone, guestEmail } from a booking body.
 * Returns { contact: null } when the booking is not for a new client,
 * { contact: { name, phone, email } } when it is and the details are valid, or
 * { error } with the message to send back as a 400.
 */
const newClientContact = (body = {}) => {
    if (body.newClient !== true) return { contact: null };
    const name = String(body.walkInName || '').trim();
    const phone = String(body.guestPhone || '').trim();
    const email = String(body.guestEmail || '').trim().toLowerCase();
    if (!isFullName(name)) return { error: 'Please enter the client’s first name and surname.' };
    if (!phone) return { error: 'Please enter the client’s phone number.' };
    if (!validPhone(phone)) return { error: 'Please enter a valid phone number.' };
    if (email && (email.length > 254 || !EMAIL_RE.test(email))) return { error: 'Please enter a valid email address, or leave it empty.' };
    return { contact: { name, phone, email: email || null } };
};

module.exports = { newClientContact };
