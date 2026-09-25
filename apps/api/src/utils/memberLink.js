const TeamMember = require('../models/TeamMember');
const { slugify } = require('./slug');

/**
 * Personal booking links — www.bookplus.pro/b/<business-slug>/<member-slug>.
 *
 * A member's handle is DERIVED, not stored: their name slugified, with -2, -3 …
 * for a second or third person of the same name in that business, in the order
 * they joined. Every roster row takes part (inactive ones too), so pausing a
 * colleague never renumbers anyone else's link. Renaming a member changes their
 * link; the old one then falls back to the business page, never a dead end.
 */
const assignSlugs = (members) => {
    const seen = new Map();
    const out = new Map();
    members.forEach((m) => {
        const base = slugify(m.name) || 'member';
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        out.set(String(m._id), n === 1 ? base : `${base}-${n}`);
    });
    return out;
};

/** Map of member id → link slug for every member of one business. */
const memberSlugMap = async (providerId) => {
    const members = await TeamMember.find({ provider: providerId })
        .select('name createdAt').sort({ createdAt: 1, _id: 1 }).lean();
    return assignSlugs(members);
};

/** The member id a link slug names in this business, or null. */
const findMemberIdBySlug = async (providerId, memberSlug) => {
    const wanted = String(memberSlug || '').trim().toLowerCase();
    if (!wanted) return null;
    const map = await memberSlugMap(providerId);
    for (const [id, s] of map) if (s === wanted) return id;
    return null;
};

module.exports = { assignSlugs, memberSlugMap, findMemberIdBySlug };
