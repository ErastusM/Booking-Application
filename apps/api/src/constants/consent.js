/**
 * Sign-up consent rules, in one place.
 *
 * MIN_SIGNUP_AGE — everyone creating an account (email or Google) must confirm
 * they are at least this old; the API refuses the sign-up otherwise. The apps
 * show the same number (@bookplus/api-client MIN_SIGNUP_AGE). NOTE: the Terms
 * of Service currently say 18 — the owner must pick one number and the Terms
 * and this constant must match.
 */
const MIN_SIGNUP_AGE = 16;

/**
 * PLAN_TERMS_VERSION — the version of the Business Terms a business owner
 * agrees to when they tick "I agree" on Add card and start plan: the terms'
 * "last updated" date (TERMS_LAST_UPDATED in packages/config/legal/terms.mjs;
 * a unit test keeps the two equal). It is recorded with the agreement, which
 * is the business's authority for the monthly charges on its saved card.
 */
const PLAN_TERMS_VERSION = '27 September 2026';

module.exports = { MIN_SIGNUP_AGE, PLAN_TERMS_VERSION };
