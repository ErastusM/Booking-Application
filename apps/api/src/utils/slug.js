const User = require('../models/User');

// Turn a business name into a URL-safe handle: lowercase, ASCII-ish, hyphenated.
// "The Vibe Barbershop!" -> "the-vibe-barbershop".
const slugify = (input) =>
    String(input || '')
        .normalize('NFKD')                    // split accents off their letters
        .replace(/[̀-ͯ]/g, '')      // drop the combining accent marks
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')          // any run of non-alphanumerics -> one hyphen
        .replace(/^-+|-+$/g, '')              // trim leading/trailing hyphens
        .replace(/-{2,}/g, '-')               // collapse repeats
        .slice(0, 60);

// A short random suffix keeps a usable slug when the name is empty or all
// symbols (slugify would otherwise yield '').
const randomSuffix = () => Math.random().toString(36).slice(2, 8);

/**
 * Generate a slug that is unique across the users collection. Starts from the
 * business name; on collision appends -2, -3, … Excludes `ignoreId` so a
 * provider re-running generation keeps their own slug instead of colliding
 * with it.
 */
const generateUniqueSlug = async (name, ignoreId = null) => {
    let base = slugify(name);
    if (!base) base = `business-${randomSuffix()}`;

    let candidate = base;
    let n = 1;
    // Bounded loop — in practice resolves in 1-2 tries; the cap is a safety net.
    for (let i = 0; i < 50; i++) {
        const query = { 'businessProfile.slug': candidate };
        if (ignoreId) query._id = { $ne: ignoreId };
        const clash = await User.findOne(query).select('_id').lean();
        if (!clash) return candidate;
        n += 1;
        candidate = `${base}-${n}`;
    }
    // Extremely unlikely fall-through: guarantee uniqueness with randomness.
    return `${base}-${randomSuffix()}`;
};

module.exports = { slugify, generateUniqueSlug };
