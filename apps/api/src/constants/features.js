/**
 * Product feature switches. Read at call time (not at require time) so a deploy
 * flips them with an env var and tests can toggle them per suite.
 *
 * WALLET_ENABLED — the prepaid client wallet. Default OFF (owner decision,
 * September 2026: all clients pay cash at the appointment; the wallet is
 * "coming soon"). While off, every money-moving wallet endpoint answers 403
 * WALLET_COMING_SOON, bookings are always cash, and the expiry and reminder
 * jobs do nothing. Reads still work, so a balance that already exists stays
 * visible (read-only) to the client and the business; nothing is deleted.
 * The apps read the same switch from packages/config/features.mjs.
 */
const walletEnabled = () => String(process.env.WALLET_ENABLED || '').toLowerCase() === 'true';

/**
 * MEMBERSHIPS_ENABLED — membership plans / session packages (Package,
 * ClientPackage). Default OFF (owner decision, September 2026, for the payment
 * provider's review). While off, every /api/packages route answers 404, so
 * nothing can be sold, bought or redeemed; existing records are kept. The apps
 * read the same switch from packages/config/features.mjs.
 */
const membershipsEnabled = () => String(process.env.MEMBERSHIPS_ENABLED || '').toLowerCase() === 'true';
const requireMemberships = (req, res, next) => (membershipsEnabled()
    ? next()
    : res.status(404).json({ success: false, message: 'Not found' }));

/**
 * SUBSCRIPTION_BILLING_ENABLED — businesses adding a card to start their
 * Bookplus plan: the first payment through PayGate (terminal 1, "One time
 * and tokenization"), which also saves the card for the monthly charges. Default OFF.
 * While off, "Add card and start plan" is never offered and every route that
 * opens or completes a card payment for a plan answers 404. It is offered only
 * when this is on AND plans are shown to businesses (admin console, Money ->
 * Subscriptions) AND PayGate is configured AND the vault wire format is
 * filled in (services/paygate.js).
 */
const subscriptionBillingEnabled = () => String(process.env.SUBSCRIPTION_BILLING_ENABLED || '').toLowerCase() === 'true';
const requireSubscriptionBilling = (req, res, next) => (subscriptionBillingEnabled()
    ? next()
    : res.status(404).json({ success: false, message: 'Not found' }));

const WALLET_COMING_SOON = {
    success: false,
    code: 'WALLET_COMING_SOON',
    message: 'The Bookplus wallet is coming soon. For now, please pay the business directly at your appointment.',
};

// Express guard for routes that move wallet money.
const requireWallet = (req, res, next) => (walletEnabled() ? next() : res.status(403).json(WALLET_COMING_SOON));

module.exports = {
    walletEnabled, WALLET_COMING_SOON, requireWallet, membershipsEnabled, requireMemberships,
    subscriptionBillingEnabled, requireSubscriptionBilling,
};
