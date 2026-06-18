const mongoose = require('mongoose');
const ProviderWallet = require('../models/ProviderWallet');
const ProviderWalletTransaction = require('../models/ProviderWalletTransaction');
const User = require('../models/User');
const { createNotification, notifyAdmins } = require('../utils/notificationhelper');

const money = (n) => `N$${Number(n || 0).toFixed(2)}`;
const isPositiveAmount = (v) => typeof v === 'number' && isFinite(v) && v > 0 && v <= 10_000_000;

const getOrCreateWallet = async (provider) => {
    let w = await ProviderWallet.findOne({ provider });
    if (!w) {
        try { w = await ProviderWallet.create({ provider }); }
        catch { w = await ProviderWallet.findOne({ provider }); }
    }
    return w;
};

/* ─────────────────────────── PROVIDER ─────────────────────────── */

// GET /api/provider-wallet/me — provider's platform balance + recent history.
exports.getMyBalance = async (req, res) => {
    try {
        const wallet = await getOrCreateWallet(req.user._id);
        const transactions = await ProviderWalletTransaction.find({ provider: req.user._id })
            .sort({ createdAt: -1 }).limit(100);
        res.status(200).json({ success: true, data: { wallet, transactions } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/provider-wallet/topup — provider submits a top-up with proof (image/PDF).
exports.submitTopUp = async (req, res) => {
    try {
        const { amount, reference, proofUrl, proofType, method } = req.body;
        if (!isPositiveAmount(amount)) {
            return res.status(400).json({ success: false, message: 'Enter a valid amount' });
        }
        const wallet = await getOrCreateWallet(req.user._id);
        const txn = await ProviderWalletTransaction.create({
            provider: req.user._id, type: 'topup', status: 'pending', amount,
            method: ['manual', 'cash'].includes(method) ? method : 'manual',
            reference: (reference || '').toString().slice(0, 60),
            proofUrl: (proofUrl || '').toString().slice(0, 500),
            proofType: ['image', 'pdf'].includes(proofType) ? proofType : '',
            initiatedBy: req.user._id,
        });
        notifyAdmins(`Provider top-up request: ${money(amount)} from ${req.user.name}`, 'wallet', '/bkplus-command');
        res.status(201).json({ success: true, message: 'Top-up submitted for admin approval', data: { wallet, transaction: txn } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/* ─────────────────────────── ADMIN ─────────────────────────── */

// GET /api/provider-wallet/admin/summary
exports.getAdminSummary = async (req, res) => {
    try {
        const [held] = await ProviderWallet.aggregate([{ $group: { _id: null, total: { $sum: '$balance' }, count: { $sum: 1 } } }]);
        const pendingTopUps = await ProviderWalletTransaction.countDocuments({ type: 'topup', status: 'pending' });
        res.status(200).json({ success: true, data: { totalHeld: held?.total || 0, walletCount: held?.count || 0, pendingTopUps } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/provider-wallet/admin/wallets — every provider's balance.
exports.getAllWallets = async (req, res) => {
    try {
        const wallets = await ProviderWallet.find()
            .populate('provider', 'name email phone avatar providerCategory')
            .sort({ balance: -1 });
        res.status(200).json({ success: true, data: wallets });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/provider-wallet/admin/topups?status=pending
exports.getTopUps = async (req, res) => {
    try {
        const query = { type: 'topup' };
        if (req.query.status) query.status = req.query.status;
        const txns = await ProviderWalletTransaction.find(query)
            .populate('provider', 'name email avatar')
            .sort({ createdAt: -1 }).limit(200);
        res.status(200).json({ success: true, data: txns });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/provider-wallet/admin/topups/:id/approve — credit the provider's balance.
exports.approveTopUp = async (req, res) => {
    try {
        const txn = await ProviderWalletTransaction.findOne({ _id: req.params.id, type: 'topup' });
        if (!txn) return res.status(404).json({ success: false, message: 'Top-up not found' });
        if (txn.status !== 'pending') return res.status(409).json({ success: false, message: 'Already resolved' });

        const wallet = await getOrCreateWallet(txn.provider);
        const before = wallet.balance;
        const updated = await ProviderWallet.findByIdAndUpdate(wallet._id, { $inc: { balance: txn.amount } }, { new: true });

        txn.status = 'approved';
        txn.balanceBefore = before;
        txn.balanceAfter = updated.balance;
        txn.resolvedBy = req.user._id;
        txn.resolvedAt = new Date();
        await txn.save();

        createNotification(txn.provider, `Your ${money(txn.amount)} account top-up was approved`, 'wallet', '/dashboard?tab=wallet');
        res.status(200).json({ success: true, message: 'Top-up approved', data: txn });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/provider-wallet/admin/topups/:id/reject
exports.rejectTopUp = async (req, res) => {
    try {
        const txn = await ProviderWalletTransaction.findOne({ _id: req.params.id, type: 'topup' });
        if (!txn) return res.status(404).json({ success: false, message: 'Top-up not found' });
        if (txn.status !== 'pending') return res.status(409).json({ success: false, message: 'Already resolved' });
        txn.status = 'rejected';
        txn.reason = (req.body.reason || '').toString().slice(0, 200) || txn.reason;
        txn.resolvedBy = req.user._id;
        txn.resolvedAt = new Date();
        await txn.save();
        createNotification(txn.provider, `Your ${money(txn.amount)} account top-up was rejected`, 'wallet', '/dashboard?tab=wallet');
        res.status(200).json({ success: true, message: 'Top-up rejected', data: txn });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// POST /api/provider-wallet/admin/adjust — admin credits or debits a provider directly.
exports.adjustBalance = async (req, res) => {
    try {
        const { providerId, amount, direction, reason } = req.body;
        if (!mongoose.isValidObjectId(providerId)) return res.status(400).json({ success: false, message: 'Invalid provider id' });
        if (!isPositiveAmount(amount)) return res.status(400).json({ success: false, message: 'Enter a valid amount' });
        if (!['credit', 'debit'].includes(direction)) return res.status(400).json({ success: false, message: 'Direction must be credit or debit' });

        const provider = await User.findOne({ _id: providerId, role: 'provider' }).select('name');
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const wallet = await getOrCreateWallet(providerId);
        const before = wallet.balance;
        let updated;
        if (direction === 'credit') {
            updated = await ProviderWallet.findByIdAndUpdate(wallet._id, { $inc: { balance: amount } }, { new: true });
        } else {
            updated = await ProviderWallet.findOneAndUpdate(
                { _id: wallet._id, balance: { $gte: amount } },
                { $inc: { balance: -amount } },
                { new: true }
            );
            if (!updated) return res.status(400).json({ success: false, message: 'Provider balance is too low for that debit' });
        }

        const txn = await ProviderWalletTransaction.create({
            provider: providerId, type: direction, status: 'approved', amount,
            reason: (reason || '').toString().slice(0, 200),
            balanceBefore: before, balanceAfter: updated.balance,
            initiatedBy: req.user._id, resolvedBy: req.user._id, resolvedAt: new Date(),
        });

        createNotification(providerId, `Bookplus ${direction === 'credit' ? 'credited' : 'debited'} ${money(amount)} ${direction === 'credit' ? 'to' : 'from'} your account`, 'wallet', '/dashboard?tab=wallet');
        res.status(201).json({ success: true, message: 'Balance adjusted', data: txn });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// GET /api/provider-wallet/admin/provider/:providerId — one provider's balance + history (assist view).
exports.getProviderDetail = async (req, res) => {
    try {
        const { providerId } = req.params;
        if (!mongoose.isValidObjectId(providerId)) return res.status(400).json({ success: false, message: 'Invalid provider id' });
        const wallet = await getOrCreateWallet(providerId);
        const transactions = await ProviderWalletTransaction.find({ provider: providerId }).sort({ createdAt: -1 }).limit(200);
        res.status(200).json({ success: true, data: { wallet, transactions } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
