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

// The Terms promise a reminder 7 days before a balance expires. This is the
// minimum time between a DELIVERED 7-day reminder and the balance being removed.
const FINAL_NOTICE_MS = 7 * DAY_MS;

const sameTime = (a, b) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

/**
 * The reminder cycle recorded on a wallet belongs to the CURRENT inactivity
 * period only if it was started for the same base expiry date (updatedAt +
 * months). Any wallet activity, or the business changing its expiry period,
 * moves the base date and starts a fresh cycle.
 */
const cycleOf = (wallet, base) => {
    const r = wallet.expiryReminder || {};
    const valid = !!base && sameTime(r.cycleBase, base);
    return {
        valid,
        forExpiry: valid && r.forExpiry ? new Date(r.forExpiry) : null,
        d30SentAt: valid && r.d30SentAt ? new Date(r.d30SentAt) : null,
        d7SentAt: valid && r.d7SentAt ? new Date(r.d7SentAt) : null,
    };
};

/**
 * The date the balance will actually expire: the base date (updatedAt + N
 * months), or later if the client had to be given their 7-day notice late (the
 * business switched expiry on or shortened it, or an email failed). This is the
 * date shown on the wallet and in reminders. null when nothing can expire.
 */
const effectiveExpiryFor = (wallet, expiryMonths) => {
    const base = expiryDateFor(wallet, expiryMonths);
    if (!base) return null;
    const c = cycleOf(wallet, base);
    return c.forExpiry && c.forExpiry > base ? c.forExpiry : base;
};

// Deleted or deactivated accounts get no reminders (their address is either
// anonymised — deleted_…@deleted.bookplus — or no longer theirs to receive mail).
const isReachable = (customer) => !!customer
    && customer.isActive !== false
    && !customer.deletedAt
    && !!customer.email
    && !/@deleted\.bookplus$/i.test(customer.email);

/**
 * Claim, send and record one reminder ('d30' or 'd7') for a wallet.
 *
 * The claim is a compare-and-set on the wallet's whole reminder state as it was
 * read (plus updatedAt), so two overlapping runs can never both send it. A 7-day
 * reminder also fixes the expiry date to at least 7 days after it is sent. If the
 * email is not delivered, the claim is rolled back so the reminder is retried and
 * — because expiry needs a recorded 7-day reminder — the balance cannot expire.
 * Written with timestamps OFF: bookkeeping never counts as wallet activity.
 */
const sendReminder = async ({ wallet, provider, months, due, nowMs }) => {
    const base = expiryDateFor(wallet, months);
    if (!base) return false;
    const customer = wallet.customer;
    if (!isReachable(customer)) return false;
    const c = cycleOf(wallet, base);
    const r = wallet.expiryReminder || {};
    const current = effectiveExpiryFor(wallet, months);
    const expiresAt = due === 'd7'
        ? new Date(Math.max(current.getTime(), nowMs + FINAL_NOTICE_MS))
        : current;

    const prior = {
        'expiryReminder.cycleBase': r.cycleBase ?? null,
        'expiryReminder.forExpiry': r.forExpiry ?? null,
        'expiryReminder.d30SentAt': r.d30SentAt ?? null,
        'expiryReminder.d7SentAt': r.d7SentAt ?? null,
    };
    const next = {
        'expiryReminder.cycleBase': base,
        'expiryReminder.forExpiry': expiresAt,
        'expiryReminder.d30SentAt': due === 'd30' ? new Date(nowMs) : c.d30SentAt,
        'expiryReminder.d7SentAt': due === 'd7' ? new Date(nowMs) : c.d7SentAt,
    };
    const claim = await Wallet.updateOne(
        { _id: wallet._id, updatedAt: wallet.updatedAt, reservedBalance: { $lte: 0 }, ...prior },
        { $set: next },
        { timestamps: false }
    );
    if (!claim.modifiedCount) return false;

    const businessName = provider.businessProfile?.businessName || provider.name || 'your business';
    const amountLabel = moneyIn(wallet.totalBalance, provider.businessProfile?.currency);
    const expiresOn = fmtDate(expiresAt);
    const daysLeft = Math.max(1, Math.ceil((expiresAt.getTime() - nowMs) / DAY_MS));
    let delivered = false;
    try {
        const result = await sendWalletExpiryReminder(customer.email, {
            name: customer.name, businessName, amountLabel, expiresOn, daysLeft, months,
        });
        delivered = !(result && (result.error || result.skipped));
    } catch (err) {
        log.warn({ err: err.message, wallet: String(wallet._id) }, 'Wallet expiry reminder email failed');
    }
    if (!delivered) {
        // Undo only our own claim (compare-and-set on what we wrote).
        await Wallet.updateOne(
            { _id: wallet._id, [`expiryReminder.${due}SentAt`]: next[`expiryReminder.${due}SentAt`] },
            { $set: { [`expiryReminder.${due}SentAt`]: null } },
            { timestamps: false }
        );
        return false;
    }
    await createNotification(
        customer._id,
        `Your ${amountLabel} wallet balance with ${businessName} expires on ${expiresOn}. Use it or top up before then to keep it.`,
        'wallet', '/wallet'
    );
    return true;
};

const CUSTOMER_FIELDS = 'name email isActive deletedAt';
const expiryProviders = () => User.find({ 'walletSettings.expiryMonths': { $gt: 0 } })
    .select('_id name walletSettings.expiryMonths businessProfile.businessName businessProfile.currency');

/**
 * Warn clients 30 and 7 days before a balance expires: one email (the same
 * emailService transport every other email uses) and one in-app notification per
 * reminder, each sent once per expiry cycle.
 */
const runReminderSweep = async (nowMs = Date.now()) => {
    let sent = 0;
    try {
        for (const provider of await expiryProviders()) {
            const months = provider.walletSettings.expiryMonths;
            // Base expiry within the widest window (or already past — a late notice).
            const newest = new Date(nowMs - months * MONTH_MS + REMINDER_DAYS[0] * DAY_MS);
            const wallets = await Wallet.find({
                provider: provider._id, totalBalance: { $gt: 0 }, reservedBalance: { $lte: 0 }, updatedAt: { $lte: newest },
            }).populate('customer', CUSTOMER_FIELDS);
            for (const wallet of wallets) {
                const effective = effectiveExpiryFor(wallet, months);
                if (!effective) continue;
                const c = cycleOf(wallet, expiryDateFor(wallet, months));
                const msLeft = effective.getTime() - nowMs;
                // The tightest window we're in decides which reminder is due; a wallet
                // first seen inside the last week gets only the 7-day one.
                let due = null;
                if (msLeft <= FINAL_NOTICE_MS) due = c.d7SentAt ? null : 'd7';
                else if (msLeft <= REMINDER_DAYS[0] * DAY_MS) due = c.d30SentAt ? null : 'd30';
                if (!due) continue;
                if (await sendReminder({ wallet, provider, months, due, nowMs })) sent += 1;
            }
        }
    } catch (err) {
        log.error({ err }, 'Wallet expiry reminder sweep failed');
    }
    return sent;
};

/**
 * Remove balances that have expired. A balance only expires once its 7-day
 * reminder for the current cycle was delivered at least 7 days earlier. A wallet
 * past its base date without one (expiry just switched on or shortened, or the
 * reminder email failed) gets the reminder now and 7 more days instead.
 */
const runExpirySweep = async (nowMs = Date.now()) => {
    const result = { expired: 0, noticed: 0 };
    try {
        for (const provider of await expiryProviders()) {
            const months = provider.walletSettings.expiryMonths;
            const cutoff = new Date(nowMs - months * MONTH_MS);
            // Inactive wallets with spendable funds and nothing reserved.
            const wallets = await Wallet.find({
                provider: provider._id, totalBalance: { $gt: 0 }, reservedBalance: { $lte: 0 }, updatedAt: { $lt: cutoff },
            }).populate('customer', CUSTOMER_FIELDS);
            for (const wallet of wallets) {
                const base = expiryDateFor(wallet, months);
                if (!base) continue;
                const c = cycleOf(wallet, base);
                const effective = effectiveExpiryFor(wallet, months);
                const noticeServed = c.d7SentAt && c.d7SentAt.getTime() <= nowMs - FINAL_NOTICE_MS;
                if (!noticeServed || effective.getTime() > nowMs) {
                    if (!c.d7SentAt && await sendReminder({ wallet, provider, months, due: 'd7', nowMs })) result.noticed += 1;
                    continue;
                }
                const customerId = wallet.customer?._id || wallet.customer;
                const before = { total: wallet.totalBalance, reserved: wallet.reservedBalance };
                const expired = wallet.totalBalance;
                const updated = await Wallet.findOneAndUpdate(
                    {
                        _id: wallet._id, reservedBalance: { $lte: 0 }, updatedAt: wallet.updatedAt,
                        'expiryReminder.d7SentAt': c.d7SentAt,
                    },
                    { $set: { totalBalance: 0 } },
                    { new: true }
                );
                if (!updated) continue; // activity happened in the meantime — skip
                await WalletTransaction.create({
                    wallet: wallet._id, customer: customerId, provider: provider._id,
                    type: 'adjustment', status: 'approved', direction: 'debit', amount: expired,
                    balanceBefore: before, balanceAfter: { total: 0, reserved: updated.reservedBalance },
                    reason: `Balance expired after ${months} months of inactivity`,
                });
                createNotification(customerId, `Your wallet balance of ${moneyIn(expired, provider.businessProfile?.currency)} expired after ${months} months of inactivity`, 'wallet', '/wallet');
                result.expired += 1;
            }
        }
    } catch (err) {
        log.error({ err }, 'Wallet expiry sweep failed');
    }
    return result;
};

// Run daily: the sweep at 02:30, the advance reminders at 07:15 (server time,
// UTC in the containers — 09:15 in Windhoek) so the emails land in the morning.
const startWalletExpiryJob = () => {
    // Wrapped in a distributed lock so only one api instance sweeps per run.
    cron.schedule('30 2 * * *', () => withLock('wallet-expiry-tick', 30 * 60 * 1000, () => runExpirySweep()));
    cron.schedule('15 7 * * *', () => withLock('wallet-expiry-reminder-tick', 30 * 60 * 1000, () => runReminderSweep()));
    log.info('Wallet expiry jobs scheduled (sweep daily 02:30, reminders daily 07:15)');
};

module.exports = startWalletExpiryJob;
module.exports.runExpirySweep = runExpirySweep;
module.exports.runReminderSweep = runReminderSweep;
module.exports.expiryDateFor = expiryDateFor;
module.exports.effectiveExpiryFor = effectiveExpiryFor;
module.exports.REMINDER_DAYS = REMINDER_DAYS;
