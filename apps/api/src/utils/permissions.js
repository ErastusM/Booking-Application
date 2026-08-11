/**
 * Staff permission flags.
 *
 * `User.staffPermissions` has existed since the invite flow shipped, but nothing
 * ever read it — every staff-facing decision was hardcoded by role instead. This
 * is where flags start actually meaning something.
 *
 * Two rules keep it honest:
 *
 *   1. ONLY flags that are genuinely enforced live in KNOWN. A vocabulary of
 *      aspirational permissions is worse than none: it reads like a security
 *      boundary while enforcing nothing, which is exactly the state this
 *      module exists to end. Add a flag here in the same change that starts
 *      checking it.
 *   2. Owners and admins are not flag-driven. A provider owns the business; a
 *      permission system that could lock them out of their own calendar would
 *      be a bug generator, not a safeguard.
 */

/** See every team member's bookings, not just your own. */
const CALENDAR_ALL = 'calendar:all';

// Enforced flags. Anything not in here is rejected when permissions are set, so
// a typo can't be stored as a permission that silently grants nothing.
const KNOWN = [CALENDAR_ALL];

/**
 * Flags the invite flow writes that are descriptive rather than enforced.
 * `calendar:self` is the ABSENCE of calendar:all — it is stored so an existing
 * roster reads sensibly, but nothing branches on it. Kept separate from KNOWN
 * so the distinction stays visible rather than becoming folklore.
 */
const DESCRIPTIVE = ['calendar:self', 'clients:assigned'];

const can = (user, flag) => {
    if (!user) return false;
    // The owner of the business, and platform admins, hold everything implicitly.
    if (user.role === 'provider' || user.role === 'admin') return true;
    if (user.role !== 'staff') return false;
    return Array.isArray(user.staffPermissions) && user.staffPermissions.includes(flag);
};

/** Split a requested flag list into the ones we accept and the ones we don't. */
const validate = (flags) => {
    const list = Array.isArray(flags) ? flags.map(String) : [];
    const allowed = KNOWN.concat(DESCRIPTIVE);
    return {
        accepted: list.filter((f) => allowed.indexOf(f) !== -1),
        rejected: list.filter((f) => allowed.indexOf(f) === -1),
    };
};

module.exports = { CALENDAR_ALL, KNOWN, DESCRIPTIVE, can, validate };
