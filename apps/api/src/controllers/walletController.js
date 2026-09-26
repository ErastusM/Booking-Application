const mongoose = require('mongoose');
const cloudinary = require('../utils/cloudinary');
const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });
exports._logger = logger; // test hook
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const walletService = require('../utils/walletService');
const { createNotification, notifyAdmins } = require('../utils/notificationhelper');
const { effectiveExpiryFor } = require('../utils/walletExpiryService');
const { walletEnabled } = require('../constants/features');
const emailService = require('../utils/emailService');
const { CURRENCIES } = require('../constants/currencies');

const money = (n) => `N$${Number(n || 0).toFixed(2)}`;

// The business a provider-side wallet VIEW is for: the owner's own id, or a
// wallet:view (High tier) staff member's employer (staffOf). Read-only views
// scope to this; money-movement handlers keep using req.user._id (owner/admin
// only, never opened to staff). Returns null for a detached staff account.
const walletBusinessScope = (req) => (req.user.role === 'staff' ? req.user.staffOf || null : req.user._id);
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

// Email the client a receipt once a top-up is approved (by the business or an
// admin). Best-effort and after the response: a failed email never undoes or
// blocks the approval. Optional-chained so a partial emailService mock in a test
// can't throw.
const SYMBOLS = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.symbol]));
const emailTopUpReceipt = async (txn) => {
    try {
        if (!emailService.sendWalletTopUpReceipt) return;
        const [customer, provider, wallet] = await Promise.all([
            User.findById(txn.customer).select('name email'),
            User.findById(txn.provider).select('name businessProfile.businessName businessProfile.currency walletSettings.refundsAllowed walletSettings.expiryMonths'),
            Wallet.findOne({ customer: txn.customer, provider: txn.provider }).select('totalBalance'),
        ]);
        if (!customer?.email || !provider) return;
        const sym = SYMBOLS[(provider.businessProfile?.currency || 'NAD').toUpperCase()] || 'N$';
        const fmt = (n) => `${sym}${Number(n || 0).toFixed(2)}`;
        await emailService.sendWalletTopUpReceipt(customer.email, {
            name: customer.name,
            businessName: provider.businessProfile?.businessName || provider.name,
            amountLabel: fmt(txn.amount),
            balanceLabel: wallet ? fmt(wallet.totalBalance) : null,
            reference: txn.reference || '',
            method: txn.method,
            date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Windhoek' }),
            refundsAllowed: provider.walletSettings?.refundsAllowed !== false,
            expiryMonths: provider.walletSettings?.expiryMonths || null,
        });
    } catch { /* receipt is best-effort */ }
};

/* ─────────────────────────── CLIENT ─────────────────────────── */

// GET /api/wallet/mine — all of the client's wallets, one per provider.
exports.getMyWallets = async (req, res) => {
    try {
        const wallets = await Wallet.find({ customer: req.user._id })
            .populate('provider', 'name avatar businessProfile providerCategory walletSettings.refundsAllowed walletSettings.expiryMonths')
            .sort({ updatedAt: -1 });
        // Each business's wallet rules travel with the balance so the client sees
        // them on the wallet card (refundable or not, and when the balance expires).
        // Only these two settings are exposed — never the rest of walletSettings.
        const data = wallets.map((w) => {
            const obj = w.toJSON();
            const ws = w.provider?.walletSettings || {};
            const expiryMonths = Number(ws.expiryMonths) > 0 ? Number(ws.expiryMonths) : null;
            if (obj.provider && typeof obj.provider === 'object') delete obj.provider.walletSettings;
            delete obj.expiryReminder;
            obj.rules = {
                refundsAllowed: ws.refundsAllowed !== false,
                expiryMonths,
                // Balances never expire while the wallet is "coming soon".
                expiresAt: walletEnabled() ? effectiveExpiryFor(w, expiryMonths) : null,
            };
            return obj;
        });
        res.status(200).json({ success: true, data });
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
                // comingSoon: the platform wallet switch is off — the business's own
                // setting is then reported as disabled so no app offers wallet payment.
                comingSoon: !walletEnabled(),
                settings: {
                    enabled: !!s.enabled && walletEnabled(),
                    bookingPaymentMode: s.bookingPaymentMode,
                    refundsAllowed: s.refundsAllowed !== false,
                    // Disclosed BEFORE the client pays (top-up modal): balances with
                    // this business expire after N months without activity, or never.
                    expiryMonths: Number(s.expiryMonths) > 0 ? Number(s.expiryMonths) : null,
                        expiresAt: existing && walletEnabled() ? effectiveExpiryFor(existing, s.expiryMonths) : null,
                    // paymentInstructions is client-facing by design (User.js documents it
                    // as bank/eWallet/PayToday "details shown to clients"), so the booking
                    // and top-up flows must keep receiving it for first-time clients who have
                    // no prior wallet relationship — a "must already be a client" gate would
                    // break those flows. But a provider who configured the wallet and then
                    // switched it OFF has withdrawn that payment offer, so don't keep leaking
                    // their free-text banking details to every authenticated caller.
                    paymentInstructions: s.enabled && walletEnabled() ? s.paymentInstructions : '',
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
        const { providerId, amount, reference, proof, method, rulesAcknowledged } = req.body;
        if (!mongoose.isValidObjectId(providerId)) {
            return res.status(400).json({ success: false, message: 'Invalid provider id' });
        }
        if (!isPositiveAmount(amount)) {
            return res.status(400).json({ success: false, message: 'Enter a valid amount' });
        }
        const provider = await User.findOne({ _id: providerId, role: 'provider' }).select('name walletSettings.refundsAllowed walletSettings.expiryMonths');
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        // The business's wallet rules are shown before paying; when the money is
        // non-refundable or can expire the client must confirm them, and we keep
        // that confirmation (with the rules shown) on the top-up. The app sends
        // rulesAcknowledged:true once "I understand" is ticked; an older app that
        // never showed the rules gets a clear message instead of a silent top-up.
        const rules = {
            refundsAllowed: provider.walletSettings?.refundsAllowed !== false,
            expiryMonths: Number(provider.walletSettings?.expiryMonths) > 0 ? Number(provider.walletSettings.expiryMonths) : null,
        };
        const ackRequired = !rules.refundsAllowed || !!rules.expiryMonths;
        if (ackRequired && rulesAcknowledged !== true) {
            return res.status(400).json({
                success: false,
                code: 'WALLET_RULES_NOT_ACKNOWLEDGED',
                message: 'Please update the app and confirm the wallet rules: this business’s wallet balance is non-refundable or can expire.',
                rules,
            });
        }

        const txn = await walletService.createTopUp({
            rulesAcknowledgedAt: rulesAcknowledged === true ? new Date() : null,
            rulesShown: rules,
            customer: req.user._id, provider: providerId, amount,
            reference: (reference || '').toString().slice(0, 60),
            // A private upload in this client's own proof folder, or nothing. A
            // bare URL (old app versions uploaded proofs publicly) is ignored:
            // proofs are never stored as public links again.
            proof: cloudinary.cleanProofRef(proof, req.user._id) || undefined,
            method: ['manual', 'cash'].includes(method) ? method : 'manual',
        });

        if (!txn.proof?.publicId && req.body.proofUrl) {
            // An app version from before private proofs uploaded publicly and sent
            // the link. It is not stored; log the row id (never the URL) so these
            // can be followed up.
            logger.warn({ transactionId: String(txn._id), legacyProofUrl: true }, 'Top-up sent a legacy public proofUrl — ignored');
        }
        const note = `New ${method === 'cash' ? 'cash ' : ''}wallet top-up request: ${money(amount)} from ${req.user.name}`;
        createNotification(providerId, note, 'wallet', '/dashboard');
        // The admin can also see and allocate top-ups.
        notifyAdmins(`${note} (for ${provider.name})`, 'wallet', '/bkplus-command');

        res.status(201).json({ success: true, message: 'Top-up request submitted for approval', data: txn });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

/* ───────────────────── PRIVATE PROOF OF PAYMENT ───────────────────── */

// POST /api/wallet/proof-upload — signed parameters for ONE private proof upload
// (Cloudinary `authenticated`, in the uploader's own folder). Shared by client
// wallet top-ups and provider account top-ups. 503 when the server has no
// Cloudinary credentials: proofs are never uploaded publicly instead.
exports.proofUploadParams = async (req, res) => {
    if (!cloudinary.isConfigured()) {
        return res.status(503).json({
            success: false, code: 'proof_upload_unavailable',
            message: 'Uploading a proof is unavailable right now. Add your payment reference instead — the business can still match your payment.',
        });
    }
    return res.status(200).json({ success: true, data: cloudinary.proofUploadParams(req.user._id) });
};

// Mint a short-lived link to a transaction's proof. Legacy rows (public link not
// yet migrated) return that link — still only to the people allowed to see it.
const proofLinkFor = (txn) => {
    if (txn.proof && txn.proof.publicId) {
        if (!cloudinary.isConfigured()) return null;
        return {
            url: cloudinary.privateDownloadUrl(txn.proof),
            expiresInSeconds: cloudinary.PROOF_LINK_SECONDS,
            kind: txn.proof.format === 'pdf' || txn.proof.resourceType === 'raw' ? 'pdf' : 'image',
        };
    }
    if (txn.proofUrl) return { url: txn.proofUrl, expiresInSeconds: null, kind: /\.pdf($|\?)/i.test(txn.proofUrl) ? 'pdf' : 'image' };
    return null;
};
exports.proofLinkFor = proofLinkFor;

// GET /api/wallet/topups/:id/proof — only the PAYER (the client) and the business
// OWNER the money was paid to. Not staff, not admins, not anyone holding the id.
exports.getTopUpProof = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Not found' });
        const txn = await WalletTransaction.findById(req.params.id).select('customer provider proof proofUrl');
        const me = String(req.user._id);
        if (!txn || (String(txn.customer) !== me && String(txn.provider) !== me)) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }
        const link = proofLinkFor(txn);
        if (!link) return res.status(404).json({ success: false, message: 'No proof attached' });
        res.set('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, data: link });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error' });
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
        const scoped = walletBusinessScope(req);
        if (!scoped) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const providerId = new mongoose.Types.ObjectId(scoped);
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
        const providerId = walletBusinessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const wallets = await Wallet.find({ provider: providerId })
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
        const providerId = walletBusinessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const query = { provider: providerId, type: 'topup' };
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
        emailTopUpReceipt(t);
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

        // Only propose an adjustment against an actual client of THIS provider — one
        // who already has a wallet with them or has booked. Without this, any
        // provider could spam arbitrary users with wallet-adjustment proposals and
        // notifications (the balance itself is safe — it needs the client's
        // approval — but the unsolicited proposal/notification should never reach a
        // stranger).
        const [hasWallet, hasBooking] = await Promise.all([
            Wallet.exists({ provider: req.user._id, customer: customerId }),
            Appointment.exists({ provider: req.user._id, customer: customerId }),
        ]);
        if (!hasWallet && !hasBooking) {
            return res.status(404).json({ success: false, message: 'Client not found' });
        }

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
        const providerId = walletBusinessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const query = { provider: providerId, type: { $in: ['adjustment', 'refund'] } };
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
        const providerId = walletBusinessScope(req);
        if (!providerId) return res.status(403).json({ success: false, message: 'No business context for this account.' });
        const query = { provider: providerId };
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
        emailTopUpReceipt(result.transaction);
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
