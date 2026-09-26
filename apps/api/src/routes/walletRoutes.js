const express = require('express');
const router = express.Router();
const { auth, authorize, allow } = require('../middleware/auth');
const wallet = require('../controllers/walletController');
const { requireWallet } = require('../constants/features');

// While the wallet is "coming soon" (WALLET_ENABLED off) every route that moves
// money or changes settings answers 403 WALLET_COMING_SOON; the GET routes stay
// open so an existing balance remains visible, read-only.

// wallet:view (High tier) is READ-ONLY: the provider dashboard/list views below.
// Money-movement routes (createAdjustment, approve/reject top-ups, settings write)
// are NOT opened — they stay authorize('provider','admin').
const canViewWallet = allow({ roles: ['provider', 'admin'], capability: 'wallet:view' });

// ── Provider: settings, dashboard, approvals (most specific paths first) ──
router.get('/settings', auth, authorize('provider', 'admin'), wallet.getSettings);
router.put('/settings', auth, requireWallet, authorize('provider', 'admin'), wallet.updateSettings);

// Admin oversight of client wallet top-ups
router.get('/admin/topups', auth, authorize('admin'), wallet.adminGetClientTopUps);
router.post('/admin/topups/:id/approve', auth, requireWallet, authorize('admin'), wallet.adminApproveTopUp);
router.post('/admin/topups/:id/reject', auth, requireWallet, authorize('admin'), wallet.adminRejectTopUp);

router.get('/provider/summary', auth, canViewWallet, wallet.getProviderSummary);
router.get('/provider/wallets', auth, canViewWallet, wallet.getProviderWallets);
router.get('/provider/topups', auth, canViewWallet, wallet.getProviderTopups);
router.get('/provider/adjustments', auth, canViewWallet, wallet.getProviderAdjustments);
router.get('/provider/transactions', auth, canViewWallet, wallet.getProviderTransactions);
router.post('/provider/adjustments', auth, requireWallet, authorize('provider', 'admin'), wallet.createAdjustment);

router.post('/topups/:id/approve', auth, requireWallet, authorize('provider', 'admin'), wallet.approveTopUp);
router.post('/topups/:id/reject', auth, requireWallet, authorize('provider', 'admin'), wallet.rejectTopUp);

// ── Client: balances, top-ups, adjustment approvals ──
router.get('/mine', auth, wallet.getMyWallets);
router.get('/mine/:providerId', auth, wallet.getMyWalletWithProvider);
router.post('/topup', auth, requireWallet, wallet.createTopUp);
// Private proof of payment: signed upload parameters, and a short-lived link to
// view one (payer or the business owner only — see the handlers). Uploading
// waits for the wallet; viewing an existing proof stays available.
router.post('/proof-upload', auth, requireWallet, wallet.proofUploadParams);
router.get('/topups/:id/proof', auth, wallet.getTopUpProof);
router.get('/transactions', auth, wallet.getMyTransactions);
router.get('/adjustments/pending', auth, wallet.getMyPendingAdjustments);
router.post('/adjustments/:id/approve', auth, requireWallet, wallet.approveAdjustment);
router.post('/adjustments/:id/reject', auth, requireWallet, wallet.rejectAdjustment);

module.exports = router;
