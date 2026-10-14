/**
 * /api/payments — online booking payments. Every route answers 404 while
 * PAYMENTS_ENABLED is off (constants/features.js).
 *
 * Two routers:
 *   - `callbacks` (/api/payments/paygate/*) is mounted in server.js BEFORE the
 *     CORS middleware: PayGate's hosted page posts the client's browser back to
 *     /return (a cross-site form post carrying PayGate's Origin), and PayGate's
 *     servers post /notify. Both are urlencoded, public, verified by checksum
 *     and then by a server-side Query — never trusted on their own.
 *   - `router` is everything else, mounted with the other API routers.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { auth, authorize } = require('../middleware/auth');
const { requirePayments } = require('../constants/features');
const { requireFinance } = require('../utils/financeRoles');
const c = require('../controllers/paymentController');

const isTest = () => process.env.NODE_ENV === 'test';

/* ── PayGate callbacks ── */
const callbacks = express.Router();
callbacks.use(requirePayments);
// Keep the raw body: the checksum is over the values IN THE ORDER POSTED, and
// unknown extra fields must be included — so we re-read it as ordered pairs.
const urlencodedRaw = express.urlencoded({
    extended: false,
    limit: '16kb',
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
});
const notifyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isTest,
    handler: (_req, res) => res.status(429).type('text/plain').send('RATE_LIMITED'),
});
const returnLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isTest,
});
callbacks.post('/notify', notifyLimiter, urlencodedRaw, c.paygateNotify);
callbacks.post('/return', returnLimiter, urlencodedRaw, c.paygateReturn);
callbacks.use((_req, res) => res.status(404).json({ success: false, message: 'Not found' }));

/* ── Everything else ── */
const router = express.Router();
router.use(requirePayments);

// The public result page polls status; retry opens a PayGate session (an
// outbound call), so it gets a tighter cap of its own.
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isTest,
    message: { success: false, message: 'Too many requests, please slow down.' },
});
const retryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isTest,
    message: { success: false, message: 'Too many payment attempts. Please try again later.' },
});

const owner = authorize('provider');
const ownerOrAdmin = authorize('provider', 'admin');
// Bookplus staff on money: an admin in a session confirmed with two-step
// sign-in, holding the finance role (utils/financeRoles).
const admin = requireFinance('finance');
const ownerOrFinance = (req, res, next) => (req.user?.role === 'admin' ? admin(req, res, next) : owner(req, res, next));

// Business setting (owner; admin may act for a business with providerId).
router.get('/settings', auth, ownerOrAdmin, c.getSettings);
router.put('/settings', auth, ownerOrAdmin, c.updateSettings);
// Public: what a client will be asked to pay at a business.
router.get('/policy/:providerId', publicLimiter, c.getPolicy);

// Payout bank account — the owner only (admins see the masked number in balances).
router.get('/payout-account', auth, owner, c.getPayoutAccount);
router.get('/payout-account/edit', auth, owner, c.getPayoutAccountForEdit);
router.put('/payout-account', auth, owner, c.updatePayoutAccount);

// Applying to take online payments (the owner): plan, details, documents,
// send it; then the business's own on/off switch once approved.
const onboarding = require('../controllers/paymentsOnboardingController');
router.get('/onboarding', auth, owner, onboarding.getOnboarding);
router.put('/onboarding', auth, owner, onboarding.updateOnboarding);
router.post('/onboarding/upload', auth, owner, onboarding.uploadParams);
router.post('/onboarding/documents', auth, owner, onboarding.addDocument);
router.delete('/onboarding/documents/:docId', auth, owner, onboarding.removeDocument);
router.post('/onboarding/submit', auth, owner, onboarding.submit);
router.put('/onboarding/switch', auth, owner, onboarding.setSwitch);

// The owner's money.
router.get('/me/balance', auth, owner, c.getMyBalance);
router.get('/me/ledger', auth, owner, c.getMyLedger);
router.get('/me/statement.csv', auth, owner, c.getMyStatementCsv);
router.get('/me/payments', auth, owner, c.getMyPayments);

// Admin.
router.get('/admin/balances', auth, admin, c.adminBalances);
router.get('/admin/payouts', auth, admin, c.adminListPayouts);
router.post('/admin/payouts', auth, admin, c.adminRecordPayout);
router.get('/admin/payments', auth, admin, c.adminListPayments);
router.get('/admin/providers/:providerId/ledger', auth, admin, c.adminProviderLedger);

// Refunds: the owner of the payment's business (up to what Bookplus holds
// for it), or Bookplus finance (approval above the limit — financeController).
router.post('/:id/refund', auth, ownerOrFinance, c.refundPayment);
router.post('/:id/refunds/:refundId/retry', auth, ownerOrFinance, c.retryRefund);

// Public result page, by unguessable reference.
router.get('/:reference/status', publicLimiter, c.getStatus);
router.post('/:reference/retry', retryLimiter, c.retry);

module.exports = router;
module.exports.callbacks = callbacks;
