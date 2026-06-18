const mongoose = require('mongoose');

/**
 * A prepaid balance a client holds WITH a specific provider.
 *
 * The Bookplus wallet is not a bank: providers are funded outside the app
 * (bank transfer, eWallet, PayToday, cash) and approve deposits manually, so a
 * client has a separate balance per provider — the provider who received the
 * money is the one who holds and approves it.
 *
 *   availableBalance = totalBalance − reservedBalance
 *
 * Balances only ever move through walletService, which writes an audit row
 * (WalletTransaction) for every change. Nothing here mutates balances directly.
 */
const walletSchema = new mongoose.Schema(
    {
        customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        // Total approved funds. Reserved is the slice held against upcoming bookings.
        totalBalance: { type: Number, default: 0, min: 0 },
        reservedBalance: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'NAD' }, // Namibian dollar (N$)
    },
    { timestamps: true }
);

// One wallet per (client, provider) pair.
walletSchema.index({ customer: 1, provider: 1 }, { unique: true });

walletSchema.virtual('availableBalance').get(function () {
    return Math.max(0, (this.totalBalance || 0) - (this.reservedBalance || 0));
});

walletSchema.set('toJSON', { virtuals: true });
walletSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Wallet', walletSchema);
