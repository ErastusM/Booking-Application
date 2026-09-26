const crypto = require('crypto');
const GiftCard = require('../models/GiftCard');
const User = require('../models/User');
const walletService = require('../utils/walletService');
const emailService = require('../utils/emailService');
const { CURRENCIES } = require('../constants/currencies');

const SYMBOLS = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.symbol]));
const currencySymbol = (code) => SYMBOLS[String(code || '').toUpperCase()] || code || 'N$';

// No 0/O/1/I/L — codes are read aloud and typed from a screenshot.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomBlock = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');
const newCode = () => `GIFT-${randomBlock(4)}-${randomBlock(4)}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const moneyLabel = (provider, n) => `${currencySymbol(provider?.businessProfile?.currency || 'NAD')}${Number(n).toFixed(0)}`;

// Gift cards are spent from the client wallet, so the business's wallet must be on.
const { walletEnabled } = require('../constants/features');
// Off while the platform wallet is "coming soon" (WALLET_ENABLED), whatever the business set.
const walletOn = (provider) => walletEnabled() && !!provider?.walletSettings?.enabled;

/* ───────────── OWNER ───────────── */

// GET /api/giftcards — the business's gift cards, newest first, with totals.
exports.listMine = async (req, res) => {
    try {
        const [cards, me] = await Promise.all([
            GiftCard.find({ provider: req.user._id }).sort({ createdAt: -1 }).limit(500).lean(),
            User.findById(req.user._id).select('walletSettings').lean(),
        ]);
        const live = cards.filter((c) => c.status !== 'void');
        res.status(200).json({
            success: true,
            data: {
                cards,
                walletEnabled: walletOn(me),
                totals: {
                    sold: live.reduce((a, c) => a + c.amount, 0),
                    unused: cards.filter((c) => c.status === 'active').reduce((a, c) => a + c.amount, 0),
                },
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/giftcards — record a sale the owner has already been paid for.
// Body: { amount, recipientName, recipientEmail?, fromName?, message?, paid: true }
exports.create = async (req, res) => {
    try {
        const { amount, recipientName, recipientEmail, fromName, message, paid } = req.body || {};
        if (paid !== true) return res.status(400).json({ success: false, message: 'Confirm you have been paid for this gift card.' });
        if (typeof amount !== 'number' || !isFinite(amount) || amount < 1 || amount > 100000) {
            return res.status(400).json({ success: false, message: 'Enter an amount between 1 and 100,000.' });
        }
        if (!String(recipientName || '').trim()) return res.status(400).json({ success: false, message: 'Who is the gift card for?' });
        const email = String(recipientEmail || '').trim().toLowerCase();
        if (email && !EMAIL_RE.test(email)) return res.status(400).json({ success: false, message: 'That email address looks wrong.' });

        const me = await User.findById(req.user._id).select('name businessProfile walletSettings');
        if (!walletOn(me)) {
            return res.status(409).json({ success: false, code: 'wallet_off', message: 'Turn on your client wallet first. Gift cards are spent from it.' });
        }

        let card = null;
        for (let i = 0; i < 5 && !card; i++) {
            try {
                card = await GiftCard.create({
                    provider: me._id, code: newCode(), amount: Math.round(amount * 100) / 100,
                    recipientName: String(recipientName).trim(), recipientEmail: email,
                    fromName: String(fromName || '').trim(), message: String(message || '').trim(),
                    soldBy: req.user._id,
                });
            } catch (err) {
                if (err?.code !== 11000) throw err; // code collision → try another
            }
        }
        if (!card) return res.status(500).json({ success: false, message: 'Could not create a gift card code. Please try again.' });

        let emailed = false;
        if (email) {
            try {
                await emailService.sendGiftCard(email, {
                    recipientName: card.recipientName, fromName: card.fromName,
                    businessName: me.businessProfile?.businessName || me.name,
                    amountLabel: moneyLabel(me, card.amount), code: card.code, message: card.message,
                });
                card.emailedAt = new Date();
                await card.save();
                emailed = true;
            } catch { /* the card is valid either way — the owner can share the code */ }
        }
        res.status(201).json({ success: true, data: { ...card.toObject(), emailed } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/giftcards/:id/void — cancel a card nobody has redeemed yet.
exports.voidCard = async (req, res) => {
    try {
        const card = await GiftCard.findOneAndUpdate(
            { _id: req.params.id, provider: req.user._id, status: 'active' },
            { $set: { status: 'void', voidedAt: new Date() } },
            { new: true }
        );
        if (!card) {
            const exists = await GiftCard.findOne({ _id: req.params.id, provider: req.user._id }).select('status').lean();
            if (!exists) return res.status(404).json({ success: false, message: 'Gift card not found' });
            return res.status(409).json({ success: false, message: exists.status === 'redeemed' ? 'This gift card has already been redeemed.' : 'This gift card is already cancelled.' });
        }
        res.status(200).json({ success: true, data: card });
    } catch (error) {
        if (error?.name === 'CastError') return res.status(404).json({ success: false, message: 'Gift card not found' });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/* ───────────── CLIENT ───────────── */

const REDEEM_MESSAGES = {
    not_found: "We couldn't find that code. Check it and try again.",
    already_redeemed: 'This gift card has already been redeemed.',
    void: 'This gift card was cancelled by the business.',
    error: 'Could not redeem the gift card. Please try again.',
};

// POST /api/giftcards/redeem — { code } → credits the caller's wallet with that business.
exports.redeem = async (req, res) => {
    try {
        if (req.user.role !== 'customer') {
            return res.status(403).json({ success: false, message: 'Sign in with your client account to redeem a gift card.' });
        }
        const result = await walletService.redeemGiftCard({ code: req.body?.code, customer: req.user._id });
        if (!result.ok) {
            const status = result.reason === 'not_found' ? 404 : result.reason === 'error' ? 500 : 409;
            return res.status(status).json({ success: false, message: REDEEM_MESSAGES[result.reason] || REDEEM_MESSAGES.error });
        }
        const provider = await User.findById(result.giftCard.provider).select('name businessProfile').lean();
        res.status(200).json({
            success: true,
            data: {
                amount: result.giftCard.amount,
                provider: { _id: provider?._id, name: provider?.businessProfile?.businessName || provider?.name, currency: provider?.businessProfile?.currency || 'NAD' },
                balance: result.wallet.totalBalance - result.wallet.reservedBalance,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
