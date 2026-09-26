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

const WALLET_COMING_SOON = {
    success: false,
    code: 'WALLET_COMING_SOON',
    message: 'The Bookplus wallet is coming soon. For now, please pay the business directly at your appointment.',
};

// Express guard for routes that move wallet money.
const requireWallet = (req, res, next) => (walletEnabled() ? next() : res.status(403).json(WALLET_COMING_SOON));

module.exports = { walletEnabled, WALLET_COMING_SOON, requireWallet };
