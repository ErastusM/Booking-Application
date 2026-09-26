const express = require('express');
const rateLimit = require('express-rate-limit');
const { auth, authorize } = require('../middleware/auth');
const giftCards = require('../controllers/giftCardController');

// Gift cards credit the client wallet, so selling and redeeming them waits for
// the wallet (403 WALLET_COMING_SOON while it is off); listing and voiding stay.
const { requireWallet } = require('../constants/features');
const router = express.Router();

// Codes are short enough to type, so guessing must be expensive: a handful of
// redeem attempts per account per hour, on top of the shared write limiter.
const redeemLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    // Always behind auth, so key on the account — not the IP.
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many attempts. Please try again in an hour.' },
    skip: () => process.env.NODE_ENV === 'test',
});

// Owner: sell, list and cancel. Staff never sell gift cards (money is the owner's).
router.get('/', auth, authorize('provider'), giftCards.listMine);
router.post('/', auth, requireWallet, authorize('provider'), giftCards.create);
router.post('/:id/void', auth, authorize('provider'), giftCards.voidCard);

// Client: redeem a code into their wallet with that business.
router.post('/redeem', auth, requireWallet, redeemLimiter, giftCards.redeem);

module.exports = router;
