const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const User = require('../models/User');
const walletService = require('../utils/walletService');
const { createNotification, notifyAdmins } = require('../utils/notificationhelper');

const money = (n) => `N$${Number(n || 0).toFixed(2)}`;
const isPositiveAmount = (v) => typeof v === 'number' && isFinite(v) && v > 0 && v <= 1_000_000;

// Default settings for a provider who hasn't configured the wallet yet.
const DEFAULT_SETTINGS = {
    enabled: false,
    bookingPaymentMode: 'wallet_required',
    refundsAllowed: true,
    expiryMonths: null,
    paymentInstructions: '',
};
const settingsOf = (user) => ({ ...DEFAULT_SETTINGS, ...(user?.walletSettings ? user.walletSettings.toObject?.() || user.walletSettings : {}) });

/* ─────────────────────────── CLIENT ─────────────────────────── */

// GET /api/wallet/mine — all of the client's wallets, one per provider.
exports.getMyWallets = async (req, res) => {
    try {
        const wallets = await Wallet.find({ customer: req.user._id })
            .populate('provider', 'name avatar businessProfile providerCategory')
            .sort({ updatedAt: -1 });
        res.status(200).json({ success: true, data: wallets });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/wallet/mine/:providerId — the client's wallet with one provider,
// plus that provider's payment instructions + booking policy.
exports.getMyWalletWithProvider = async (req, res) => {
    try {
        const { providerId } = req.params;
        if (!mongoose.isValidObjectId(providerId)) {
            return res.status(400).json({ success: false, message: 'Invalid provider id' });
        }
        const provider = await User.findOne({ _id: providerId, role: 'provider' }).select('name avatar businessProfile walletSettings');
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        // Read-only: don't create a wallet just from viewing (e.g. the booking page).
        // A real wallet is created on the first top-up or reservation.
        const existing = await Wallet.findOne({ customer: req.user._id, provider: providerId });
        const wallet = existing || {
            customer: req.user._id, provider: providerId,
            totalBalance: 0, reservedBalance: 0, availableBalance: 0, currency: 'NAD',
        };
        const s = settingsOf(provider);
        res.status(200).json({
            success: true,
            data: {
                wallet,
                provider: { _id: provider._id, name: provider.name, avatar: provider.avatar },
                settings: {
                    enabled: s.enabled,
                    bookingPaymentMode: s.bookingPaymentMode,
                    refundsAllowed: s.refundsAllowed,
                    paymentInstructions: s.paymentInstructions,
                },
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/wallet/topup — client requests a top-up (pending until approved).
exports.createTopUp = async (req, res) => {
    try {
        const { providerId, amount, reference, proofUrl, method } = req.body;
        if (!mongoose.isValidObjectId(providerId)) {
            return res.status(400).json({ success: false, message: 'Invalid provider id' });
        }
        if (!isPositiveAmount(amount)) {
            return res.status(400).json({ success: false, message: 'Enter a valid amount' });
        }
        const provider = await User.findOne({ _id: providerId, role: 'provider' }).select('name');
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const txn = await walletService.createTopUp({
            customer: req.user._id, provider: providerId, amount,
            reference: (reference || '').toString().slice(0, 60),
            proofUrl: (proofUrl || '').toString().slice(0, 500),
            method: ['manual', 'cash'].includes(method) ? method : 'manual',
        });

        const note = `New ${method === 'cash' ? 'cash ' : ''}wallet top-up request: ${money(amount)} from ${req.user.name}`;
        createNotification(providerId, note, 'wallet', '/dashboard');
        // The admin can also see and allocate top-ups.
        notifyAdmins(`${note} (for ${provider.name})`, 'wallet', '/bkplus-command');

        res.status(201).json({ success: true, message: 'Top-up request submitted for approval', data: txn });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/wallet/transactions?providerId= — client history.
exports.getMyTransactions = async (req, res) => {
    try {
        const query = { customer: req.user._id };
        if (req.query.providerId && mongoose.isValidObjectId(req.query.providerId)) {
            query.provider = req.query.providerId;
        }
        const txns = await WalletTransaction.find(query)
            .populate('provider', 'name')
            .sort({ createdAt: -1 })
            .limit(200);
        res.status(200).json({ success: true, data: txns });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/wallet/adjustments/pending — adjustments awaiting the client's approval.
exports.getMyPendingAdjustments = async (req, res) => {
    try {
        const txns = await WalletTransaction.find({
            customer: req.user._id, status: 'pending', type: { $in: ['adjustment', 'refund'] },
        }).populate('provider', 'name').sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: txns });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/wallet/adjustments/:id/approve
exports.approveAdjustment = async (req, res) => {
    try {
        const result = await walletService.approveAdjustment({ transactionId: req.params.id, customerId: req.user._id });
        if (!result.ok) {
            const map = { not_found: [404, 'Adjustment not found'], already_resolved: [409, 'Already resolved'], insufficient_balance: [400, 'Not enough available balance for this debit'] };
            const [code, msg] = map[result.reason] || [400, 'Could not approve'];
            return res.status(code).json({ success: false, message: msg });
        }
        const t = result.transaction;
        createNotification(t.provider, `${req.user.name} approved your ${money(t.amount)} ${t.direction} adjustment`, 'wallet', '/dashboard');
        res.status(200).json({ success: true, message: 'Adjustment approved', data: result.transaction });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/wallet/adjustments/:id/reject
exports.rejectAdjustment = async (req, res) => {
    try {
        const result = await walletService.rejectAdjustment({ transactionId: req.params.id, customerId: req.user._id });
        if (!result.ok) {
            return res.status(result.reason === 'not_found' ? 404 : 409).json({ success: false, message: 'Could not reject' });
        }
        const t = result.transaction;
        createNotification(t.provider, `${req.user.name} declined your ${money(t.amount)} ${t.direction} adjustment`, 'wallet', '/dashboard');
        res.status(200).json({ success: true, message: 'Adjustment rejected', data: result.transaction });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/* ─────────────────────────── PROVIDER ─────────────────────────── */

// GET /api/wallet/provider/summary — dashboard headline figures.
exports.getProviderSummary = async (req, res) => {
    try {
        const providerId = new mongoose.Types.ObjectId(req.user._id);
        const [balances] = await Wallet.aggregate([
            { $match: { provider: providerId } },
            { $group: { _id: null, fundsHeld: { $sum: '$totalBalance' }, totalReserved: { $sum: '$reservedBalance' }, wallets: { $sum: 1 } } },
        ]);
        const [deducted] = await WalletTransaction.aggregate([
            { $match: { provider: providerId, type: 'deduction', status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        const [pendingTopUps, pendingAdjustments] = await Promise.all([
            WalletTransaction.countDocuments({ provider: providerId, type: 'topup', status: 'pending' }),
            WalletTransaction.countDocuments({ provider: providerId, type: { $in: ['adjustment', 'refund'] }, status: 'pending' }),
        ]);
        res.status(200).json({
            success: true,
            data: {
                fundsHeld: balances?.fundsHeld || 0,
                totalReserved: balances?.totalReserved || 0,
                totalAvailable: Math.max(0, (balances?.fundsHeld || 0) - (balances?.totalReserved || 0)),
                totalDeducted: deducted?.total || 0,
                walletCount: balances?.wallets || 0,
                pendingTopUps,
                pendingAdjustments,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/wallet/provider/wallets — every client wallet this provider holds.
exports.getProviderWallets = async (req, res) => {
    try {
        const wallets = await Wallet.find({ provider: req.user._id })
            .populate('customer', 'name email phone avatar')
            .sort({ updatedAt: -1 });
        res.status(200).json({ success: true, data: wallets });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/wallet/provider/topups?status=pending
exports.getProviderTopups = async (req, res) => {
    try {
        const query = { provider: req.user._id, type: 'topup' };
        if (req.query.status) query.status = req.query.status;
        const txns = await WalletTransaction.find(query)
            .populate('customer', 'name email phone avatar')
            .sort({ createdAt: -1 })
            .limit(200);
        res.status(200).json({ success: true, data: txns });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/wallet/topups/:id/approve
exports.approveTopUp = async (req, res) => {
    try {
        const result = await walletService.approveTopUp({ transactionId: req.params.id, providerId: req.user._id });
        if (!result.ok) {
            return res.status(result.reason === 'not_found' ? 404 : 409).json({ success: false, message: result.reason === 'already_resolved' ? 'This top-up was already resolved' : 'Top-up not found' });
        }
        const t = result.transaction;
        createNotification(t.customer, `Your ${money(t.amount)} top-up was approved — it's now in your wallet`, 'wallet', '/wallet');
        res.status(200).json({ success: true, message: 'Top-up approved', data: result.transaction });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/wallet/topups/:id/reject
exports.rejectTopUp = async (req, res) => {
    try {
        const result = await walletService.rejectTopUp({ transactionId: req.params.id, providerId: req.user._id, reason: (req.body.reason || '').toString().slice(0, 200) });
        if (!result.ok) {
            return res.status(result.reason === 'not_found' ? 404 : 409).json({ success: false, message: result.reason === 'already_resolved' ? 'This top-up was already resolved' : 'Top-up not found' });
        }
        const t = result.transaction;
        createNotification(t.customer, `Your ${money(t.amount)} top-up request was rejected`, 'wallet', '/wallet');
        res.status(200).json({ success: true, message: 'Top-up rejected', data: result.transaction });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/wallet/provider/adjustments — propose a credit/debit/refund (needs client approval).
exports.createAdjustment = async (req, res) => {
    try {
        const { customerId, amount, direction, reason, isRefund } = req.body;
        if (!mongoose.isValidObjectId(customerId)) {
            return res.status(400).json({ success: false, message: 'Invalid client id' });
        }
        if (!isPositiveAmount(amount)) {
            return res.status(400).json({ success: false, message: 'Enter a valid amount' });
        }
        if (!['credit', 'debit'].includes(direction)) {
            return res.status(400).json({ success: false, message: 'Direction must be credit or debit' });
        }
        if (isRefund) {
            const me = await User.findById(req.user._id).select('walletSettings');
            if (!settingsOf(me).refundsAllowed) {
                return res.status(400).json({ success: false, message: 'Refunds are turned off in your wallet settings' });
            }
        }
        const client = await User.findById(customerId).select('name');
        if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

        const txn = await walletService.createAdjustment({
            provider: req.user._id, customer: customerId, amount, direction,
            reason: (reason || '').toString().slice(0, 200), isRefund: !!isRefund,
        });

        const label = isRefund ? 'refund' : `${direction}`;
        createNotification(
            customerId,
            `${req.user.name} proposed a ${money(amount)} ${label} to your wallet — approve or decline in your wallet`,
            'wallet', '/wallet'
        );
        res.status(201).json({ success: true, message: 'Adjustment proposed — awaiting client approval', data: txn });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/wallet/provider/adjustments?status=
exports.getProviderAdjustments = async (req, res) => {
    try {
        const query = { provider: req.user._id, type: { $in: ['adjustment', 'refund'] } };
        if (req.query.status) query.status = req.query.status;
        const txns = await WalletTransaction.find(query)
            .populate('customer', 'name email avatar')
            .sort({ createdAt: -1 })
            .limit(200);
        res.status(200).json({ success: true, data: txns });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/wallet/provider/transactions?customerId= — full activity history.
exports.getProviderTransactions = async (req, res) => {
    try {
        const query = { provider: req.user._id };
        if (req.query.customerId && mongoose.isValidObjectId(req.query.customerId)) {
            query.customer = req.query.customerId;
        }
        const txns = await WalletTransaction.find(query)
            .populate('customer', 'name email avatar')
            .sort({ createdAt: -1 })
            .limit(300);
        res.status(200).json({ success: true, data: txns });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/wallet/settings — provider's own wallet settings.
exports.getSettings = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('walletSettings');
        res.status(200).json({ success: true, data: settingsOf(user) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// PUT /api/wallet/settings
exports.updateSettings = async (req, res) => {
    try {
        const { enabled, bookingPaymentMode, refundsAllowed, expiryMonths, paymentInstructions } = req.body;
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (!user.walletSettings) user.walletSettings = {};

        if (enabled !== undefined) user.walletSettings.enabled = !!enabled;
        if (bookingPaymentMode !== undefined) {
            if (!['wallet_required', 'wallet_optional'].includes(bookingPaymentMode)) {
                return res.status(400).json({ success: false, message: 'Invalid booking payment mode' });
            }
            user.walletSettings.bookingPaymentMode = bookingPaymentMode;
        }
        if (refundsAllowed !== undefined) user.walletSettings.refundsAllowed = !!refundsAllowed;
        if (expiryMonths !== undefined) {
            const allowed = [null, 6, 12, 24];
            const v = expiryMonths === null || expiryMonths === '' ? null : Number(expiryMonths);
            if (!allowed.includes(v)) {
                return res.status(400).json({ success: false, message: 'Expiry must be 6, 12, 24 months or never' });
            }
            user.walletSettings.expiryMonths = v;
        }
        if (paymentInstructions !== undefined) {
            user.walletSettings.paymentInstructions = paymentInstructions.toString().slice(0, 1000);
        }

        user.markModified('walletSettings');
        await user.save();
        res.status(200).json({ success: true, message: 'Wallet settings saved', data: settingsOf(user) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/* ───────────────────── ADMIN oversight of client top-ups ───────────────────── */

// GET /api/wallet/admin/topups?status=pending — client wallet top-ups across all providers.
exports.adminGetClientTopUps = async (req, res) => {
    try {
        const query = { type: 'topup' };
        if (req.query.status) query.status = req.query.status;
        const txns = await WalletTransaction.find(query)
            .populate('customer', 'name email avatar')
            .populate('provider', 'name')
            .sort({ createdAt: -1 })
            .limit(200);
        res.status(200).json({ success: true, data: txns });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/wallet/admin/topups/:id/approve — admin allocates a client top-up.
exports.adminApproveTopUp = async (req, res) => {
    try {
        const result = await walletService.approveTopUp({ transactionId: req.params.id, resolvedBy: req.user._id });
        if (!result.ok) return res.status(result.reason === 'not_found' ? 404 : 409).json({ success: false, message: result.reason === 'already_resolved' ? 'This top-up was already resolved' : 'Top-up not found' });
        createNotification(result.transaction.customer, `Your ${money(result.transaction.amount)} top-up was approved — it's now in your wallet`, 'wallet', '/wallet');
        res.status(200).json({ success: true, message: 'Top-up approved', data: result.transaction });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/wallet/admin/topups/:id/reject
exports.adminRejectTopUp = async (req, res) => {
    try {
        const result = await walletService.rejectTopUp({ transactionId: req.params.id, resolvedBy: req.user._id, reason: (req.body.reason || '').toString().slice(0, 200) });
        if (!result.ok) return res.status(result.reason === 'not_found' ? 404 : 409).json({ success: false, message: result.reason === 'already_resolved' ? 'This top-up was already resolved' : 'Top-up not found' });
        createNotification(result.transaction.customer, `Your ${money(result.transaction.amount)} top-up request was rejected`, 'wallet', '/wallet');
        res.status(200).json({ success: true, message: 'Top-up rejected', data: result.transaction });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
