const cron = require('node-cron');
const pino = require('pino');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const { createNotification } = require('./notificationhelper');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Wallet balance expiry (spec §11). Providers may opt their wallets into expiry
 * after 6 / 12 / 24 months. Once a day we zero the AVAILABLE balance of wallets
 * that have been inactive (no transaction) for at least that long, leaving any
 * reserved funds untouched, and write an audit row + notify the client.
 *
 * Conservative by design: only runs for providers who opted in, never touches
 * reserved funds, and records every expiry.
 */
const runExpirySweep = async () => {
    try {
        const providers = await User.find({ 'walletSettings.expiryMonths': { $gt: 0 } }).select('_id walletSettings.expiryMonths');
        const now = Date.now();
        for (const provider of providers) {
            const months = provider.walletSettings.expiryMonths;
            const cutoff = new Date(now - months * 30 * 24 * 60 * 60 * 1000);
            // Inactive wallets with spendable funds and nothing reserved.
            const wallets = await Wallet.find({
                provider: provider._id,
                totalBalance: { $gt: 0 },
                reservedBalance: { $lte: 0 },
                updatedAt: { $lt: cutoff },
            });
            for (const wallet of wallets) {
                const before = { total: wallet.totalBalance, reserved: wallet.reservedBalance };
                const expired = wallet.totalBalance;
                const updated = await Wallet.findOneAndUpdate(
                    { _id: wallet._id, reservedBalance: { $lte: 0 }, updatedAt: { $lt: cutoff } },
                    { $set: { totalBalance: 0 } },
                    { new: true }
                );
                if (!updated) continue; // activity happened in the meantime — skip
                await WalletTransaction.create({
                    wallet: wallet._id, customer: wallet.customer, provider: provider._id,
                    type: 'adjustment', status: 'approved', direction: 'debit', amount: expired,
                    balanceBefore: before, balanceAfter: { total: 0, reserved: updated.reservedBalance },
                    reason: `Balance expired after ${months} months of inactivity`,
                });
                createNotification(wallet.customer, `Your wallet balance of N$${expired.toFixed(2)} expired after ${months} months of inactivity`, 'wallet', '/wallet');
            }
        }
    } catch (err) {
        log.error({ err }, 'Wallet expiry sweep failed');
    }
};

// Run daily at 02:30.
const startWalletExpiryJob = () => {
    cron.schedule('30 2 * * *', runExpirySweep);
    log.info('Wallet expiry job scheduled (daily 02:30)');
};

module.exports = startWalletExpiryJob;
module.exports.runExpirySweep = runExpirySweep;
