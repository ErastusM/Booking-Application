/**
 * /api/subscriptions — a business owner's own Bookplus plan.
 *
 * Two routers:
 *   - `callbacks` (/api/subscriptions/paygate/*) is mounted in server.js
 *     BEFORE the CORS middleware: PayGate's hosted page posts the owner's
 *     browser back to /return (a cross-site form post), and PayGate's servers
 *     post /notify. Both are urlencoded, public, verified by checksum and then
 *     by a server-side Query; never trusted on their own. 404 while
 *     SUBSCRIPTION_BILLING_ENABLED is off.
 *   - `router` is everything else.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { auth, authorize } = require('../middleware/auth');
const { requireSubscriptionBilling } = require('../constants/features');
const c = require('../controllers/subscriptionController');

const isTest = () => process.env.NODE_ENV === 'test';

/* ── PayGate callbacks ── */
const callbacks = express.Router();
callbacks.use(requireSubscriptionBilling);
// Keep the raw body: the checksum is over the values IN THE ORDER POSTED.
const urlencodedRaw = express.urlencoded({
    extended: false,
    limit: '16kb',
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
});
const notifyLimiter = rateLimit({
    windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, skip: isTest,
    handler: (_req, res) => res.status(429).type('text/plain').send('RATE_LIMITED'),
});
const returnLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, skip: isTest });
callbacks.post('/notify', notifyLimiter, urlencodedRaw, c.paygateNotify);
callbacks.post('/return', returnLimiter, urlencodedRaw, c.paygateReturn);
callbacks.use((_req, res) => res.status(404).json({ success: false, message: 'Not found' }));

/* ── The owner's plan ── */
const router = express.Router();
const owner = authorize('provider');
// Opening a PayGate session is an outbound call (and, once a card is typed, a
// fee): a tight cap of its own on top of the per-business daily limit.
const checkoutLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, skip: isTest,
    message: { success: false, message: 'Too many card attempts. Please try again later.' },
});

// A business owner's own plan (team members have none of their own).
router.get('/me', auth, owner, c.mine);
router.post('/me/checkout', requireSubscriptionBilling, checkoutLimiter, auth, owner, c.startCheckout);
router.get('/me/checkout/:reference', requireSubscriptionBilling, auth, owner, c.checkoutStatus);
router.get('/me/payments', requireSubscriptionBilling, auth, owner, c.payments);
router.post('/me/cancel', requireSubscriptionBilling, auth, owner, c.cancel);
router.post('/me/keep', requireSubscriptionBilling, auth, owner, c.keep);

module.exports = router;
module.exports.callbacks = callbacks;
