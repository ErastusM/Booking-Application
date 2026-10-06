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
 * PAYMENTS_ENABLED — online card payments for bookings through PayGate PayHost
 * (deposits / full prepayment, refunds, the balance Bookplus owes each business
 * and the payouts recorded against it). Default OFF (owner decision, October
 * 2026): until it is switched on every booking behaves exactly as before (pay
 * at the appointment), the business's payment setting is ignored, the hold
 * sweeper does nothing and every /api/payments route answers 404. The apps read
 * the same switch from packages/config/features.mjs.
 */
const paymentsEnabled = () => String(process.env.PAYMENTS_ENABLED || '').toLowerCase() === 'true';
const requirePayments = (req, res, next) => (paymentsEnabled()
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
    paymentsEnabled, requirePayments,
};
