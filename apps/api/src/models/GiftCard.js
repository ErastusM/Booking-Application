const mongoose = require('mongoose');

/**
 * A gift card sold by one business. Money never moves through Bookplus: the
 * owner is paid directly (cash, EFT, PayToday) and records the sale here. The
 * card's value becomes WALLET credit with that business when someone redeems
 * the code — so it is spent exactly like a wallet top-up.
 *
 * status: active (sold, not yet redeemed) → redeemed (credited to a wallet)
 *         active → void (cancelled by the owner before anyone redeemed it)
 */
const giftCardSchema = new mongoose.Schema(
    {
        provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        // Human-typeable, unambiguous alphabet (no 0/O/1/I/L). Unique platform-wide.
        code: { type: String, required: true, unique: true, uppercase: true, trim: true },
        amount: { type: Number, required: true, min: 1 },

        recipientName: { type: String, required: true, trim: true, maxlength: 80 },
        recipientEmail: { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },
        fromName: { type: String, default: '', trim: true, maxlength: 80 },
        message: { type: String, default: '', trim: true, maxlength: 300 },

        status: { type: String, enum: ['active', 'redeemed', 'void'], default: 'active', index: true },
        soldBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        emailedAt: { type: Date, default: null },

        redeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        redeemedAt: { type: Date, default: null },
        walletTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

        voidedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model('GiftCard', giftCardSchema);
