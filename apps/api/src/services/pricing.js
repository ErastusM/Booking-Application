/**
 * Bookplus's pricing settings (PlatformSettings): the business subscription
 * plan's trial, introductory and standard prices. Bookplus takes no commission
 * and no booking payments. Cached briefly; nothing is hard-coded here.
 */
const PlatformSettings = require('../models/PlatformSettings');


/* ───────────────────────────── settings (cached) ───────────────────────────── */

let cache = null;
let cacheAt = 0;
// Tests clear the database between cases, so they always read it fresh.
const CACHE_MS = process.env.NODE_ENV === 'test' ? 0 : 30 * 1000;

const defaultsDoc = () => ({ key: 'platform', plans: JSON.parse(JSON.stringify(PlatformSettings.DEFAULTS.plans)) });

/** The settings document, created with the specification's values on first use. */
const getSettings = async ({ fresh = false } = {}) => {
    if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;
    let doc = await PlatformSettings.findOne({ key: 'platform' }).lean();
    if (!doc) {
        try {
            await PlatformSettings.create(defaultsDoc());
        } catch (err) {
            if (!(err && err.code === 11000)) throw err; // another request created it first
        }
        doc = await PlatformSettings.findOne({ key: 'platform' }).lean();
    }
    cache = doc;
    cacheAt = Date.now();
    return doc;
};
const invalidateSettings = () => { cache = null; cacheAt = 0; };

module.exports = { getSettings, invalidateSettings };
