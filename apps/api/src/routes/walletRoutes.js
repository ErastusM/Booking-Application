const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const wallet = require('../controllers/walletController');

// ── Provider: settings, dashboard, approvals (most specific paths first) ──
router.get('/settings', auth, authorize('provider', 'admin'), wallet.getSettings);
router.put('/settings', auth, authorize('provider', 'admin'), wallet.updateSettings);

// Admin oversight of client wallet top-ups
router.get('/admin/topups', auth, authorize('admin'), wallet.adminGetClientTopUps);
router.post('/admin/topups/:id/approve', auth, authorize('admin'), wallet.adminApproveTopUp);
router.post('/admin/topups/:id/reject', auth, authorize('admin'), wallet.adminRejectTopUp);

router.get('/provider/summary', auth, authorize('provider', 'admin'), wallet.getProviderSummary);
router.get('/provider/wallets', auth, authorize('provider', 'admin'), wallet.getProviderWallets);
router.get('/provider/topups', auth, authorize('provider', 'admin'), wallet.getProviderTopups);
router.get('/provider/adjustments', auth, authorize('provider', 'admin'), wallet.getProviderAdjustments);
router.get('/provider/transactions', auth, authorize('provider', 'admin'), wallet.getProviderTransactions);
router.post('/provider/adjustments', auth, authorize('provider', 'admin'), wallet.createAdjustment);

router.post('/topups/:id/approve', auth, authorize('provider', 'admin'), wallet.approveTopUp);
router.post('/topups/:id/reject', auth, authorize('provider', 'admin'), wallet.rejectTopUp);

// ── Client: balances, top-ups, adjustment approvals ──
router.get('/mine', auth, wallet.getMyWallets);
router.get('/mine/:providerId', auth, wallet.getMyWalletWithProvider);
router.post('/topup', auth, wallet.createTopUp);
router.get('/transactions', auth, wallet.getMyTransactions);
router.get('/adjustments/pending', auth, wallet.getMyPendingAdjustments);
router.post('/adjustments/:id/approve', auth, wallet.approveAdjustment);
router.post('/adjustments/:id/reject', auth, wallet.rejectAdjustment);

module.exports = router;
