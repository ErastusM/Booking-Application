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

module.exports = { MIN_SIGNUP_AGE };
