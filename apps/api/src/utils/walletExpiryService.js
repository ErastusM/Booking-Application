const cron = require('node-cron');
const pino = require('pino');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const { createNotification } = require('./notificationhelper');
const { withLock } = require('./lock');
const { sendWalletExpiryReminder } = require('./emailService');
const { CURRENCIES } = require('../constants/currencies');

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
const DAY_MS = 24 * 60 * 60 * 1000;
// A "month" here is 30 days — the same arithmetic the sweep's cutoff uses, so the
// date we show and warn about is exactly the day the sweep can zero the balance.
const MONTH_MS = 30 * DAY_MS;
// Advance warnings, in days before expiry (largest first).
const REMINDER_DAYS = [30, 7];

const SYMBOLS = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.symbol]));
const moneyIn = (n, code) => `${SYMBOLS[(code || '').toUpperCase()] || 'N$'}${Number(n || 0).toFixed(2)}`;

/**
 * When a wallet's balance will expire under its business's rule, or null when it
 * won't: no expiry set, nothing to lose, or funds reserved for an upcoming booking
 * (the sweep never touches those). Inactivity is measured from the wallet's last
 * change (updatedAt), exactly as runExpirySweep does.
 */
const expiryDateFor = (wallet, expiryMonths) => {
    const months = Number(expiryMonths) || 0;
    if (!wallet || months <= 0) return null;
    if (!((wallet.totalBalance || 0) > 0) || (wallet.reservedBalance || 0) > 0) return null;
    const last = wallet.updatedAt ? new Date(wallet.updatedAt).getTime() : NaN;
    if (!Number.isFinite(last)) return null;
    return new Date(last + months * MONTH_MS);
};

const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Windhoek' });

/**
 * Warn clients 30 and 7 days before a balance expires: one email (the same
 * emailService transport every other email uses) and one in-app notification per
 * reminder. Each reminder is sent once per expiry date — recorded on the wallet
 * with timestamps OFF, so the bookkeeping itself never counts as activity.
 */
const runReminderSweep = async (nowMs = Date.now()) => {
    let sent = 0;
    try {
        const providers = await User.find({ 'walletSettings.expiryMonths': { $gt: 0 } })
            .select('_id name walletSettings.expiryMonths businessProfile.businessName businessProfile.currency');
        for (const provider of providers) {
            const months = provider.walletSettings.expiryMonths;
            // Only wallets whose expiry falls inside the widest reminder window.
            const oldest = new Date(nowMs - months * MONTH_MS);
            const newest = new Date(nowMs - months * MONTH_MS + REMINDER_DAYS[0] * DAY_MS);
            const wallets = await Wallet.find({
                provider: provider._id,
                totalBalance: { $gt: 0 },
                reservedBalance: { $lte: 0 },
                updatedAt: { $gte: oldest, $lte: newest },
            }).populate('customer', 'name email');
            const businessName = provider.businessProfile?.businessName || provider.name || 'your business';
            for (const wallet of wallets) {
                const expiresAt = expiryDateFor(wallet, months);
                if (!expiresAt || !wallet.customer) continue;
                const msLeft = expiresAt.getTime() - nowMs;
                if (msLeft <= 0) continue; // the sweep handles it
                const daysLeft = Math.ceil(msLeft / DAY_MS);

                const r = wallet.expiryReminder || {};
                const sameExpiry = r.forExpiry && new Date(r.forExpiry).getTime() === expiresAt.getTime();
                const already = { d30: sameExpiry && !!r.d30SentAt, d7: sameExpiry && !!r.d7SentAt };
                // The tightest window we're in decides which reminder is due; a wallet
                // first seen at 5 days out gets only the 7-day one.
                const due = daysLeft <= 7 ? (already.d7 ? null : 'd7') : (already.d30 ? null : 'd30');
                if (!due) continue;

                // Claim the reminder before sending, so two overlapping runs can't
                // both send it. The filter re-checks the wallet is unchanged since we
                // read it; timestamps:false keeps updatedAt (the expiry clock) intact.
                const claim = await Wallet.updateOne(
                    {
                        _id: wallet._id, updatedAt: wallet.updatedAt,
                        ...(sameExpiry ? { [`expiryReminder.${due}SentAt`]: null } : {}),
                    },
                    {
                        $set: {
                            'expiryReminder.forExpiry': expiresAt,
                            [`expiryReminder.${due}SentAt`]: new Date(nowMs),
                            // A new expiry date starts a new cycle.
                            ...(sameExpiry ? {} : { [`expiryReminder.${due === 'd7' ? 'd30' : 'd7'}SentAt`]: due === 'd7' ? new Date(nowMs) : null }),
                        },
                    },
                    { timestamps: false }
                );
                if (!claim.modifiedCount) continue;

                const amountLabel = moneyIn(wallet.totalBalance, provider.businessProfile?.currency);
                const expiresOn = fmtDate(expiresAt);
                if (wallet.customer.email) {
                    await sendWalletExpiryReminder(wallet.customer.email, {
                        name: wallet.customer.name, businessName, amountLabel, expiresOn, daysLeft, months,
                    });
                }
                await createNotification(
                    wallet.customer._id,
                    `Your ${amountLabel} wallet balance with ${businessName} expires on ${expiresOn}. Use it or top up before then to keep it.`,
                    'wallet', '/wallet'
                );
                sent += 1;
            }
        }
    } catch (err) {
        log.error({ err }, 'Wallet expiry reminder sweep failed');
    }
    return sent;
};

const runExpirySweep = async () => {
    try {
        const providers = await User.find({ 'walletSettings.expiryMonths': { $gt: 0 } }).select('_id walletSettings.expiryMonths businessProfile.currency');
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
                createNotification(wallet.customer, `Your wallet balance of ${moneyIn(expired, provider.businessProfile?.currency)} expired after ${months} months of inactivity`, 'wallet', '/wallet');
            }
        }
    } catch (err) {
        log.error({ err }, 'Wallet expiry sweep failed');
    }
};

// Run daily: the sweep at 02:30, the advance reminders at 07:15 (server time,
// UTC in the containers — 09:15 in Windhoek) so the emails land in the morning.
const startWalletExpiryJob = () => {
    // Wrapped in a distributed lock so only one api instance sweeps per run.
    cron.schedule('30 2 * * *', () => withLock('wallet-expiry-tick', 30 * 60 * 1000, runExpirySweep));
    cron.schedule('15 7 * * *', () => withLock('wallet-expiry-reminder-tick', 30 * 60 * 1000, () => runReminderSweep()));
    log.info('Wallet expiry jobs scheduled (sweep daily 02:30, reminders daily 07:15)');
};

module.exports = startWalletExpiryJob;
module.exports.runExpirySweep = runExpirySweep;
module.exports.runReminderSweep = runReminderSweep;
module.exports.expiryDateFor = expiryDateFor;
module.exports.REMINDER_DAYS = REMINDER_DAYS;
