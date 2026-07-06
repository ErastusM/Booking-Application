const mongoose = require('mongoose');

/**
 * A provider's prepaid balance WITH the Bookplus platform.
 *
 * Separate from the client↔provider Wallet: here the counterparty is the
 * platform (admins). Providers fund this account out-of-band and submit proof;
 * an admin verifies and tops it up. Balances change only through
 * providerWalletController, which writes a ProviderWalletTransaction audit row.
 */
const providerWalletSchema = new mongoose.Schema(
    {
        provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
        balance: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'NAD' },
    },
    { timestamps: true }
);

module.exports = mongoose.model('ProviderWallet', providerWalletSchema);
