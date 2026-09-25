/**
 * Client names must be full names — a first name AND a surname — so a business
 * can tell apart two clients who share one of them (three "Shilongo"s in one
 * week's bookings, or two "Maria"s). A "name" here is two or more words, each
 * with at least two letters: "Ndapewa Shilongo", "Jean-Luc O'Neil" pass;
 * "Shilongo", "N Shilongo" and "Maria ." do not.
 */
const PART = /\p{L}.*\p{L}/u; // at least two letters in the word

const isFullName = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length >= 2 && parts.every((p) => PART.test(p));
};

const FULL_NAME_MESSAGE = 'Please enter your first name and surname.';

module.exports = { isFullName, FULL_NAME_MESSAGE };
