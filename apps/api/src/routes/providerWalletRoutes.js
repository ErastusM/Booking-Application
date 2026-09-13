const express = require('express');
const router = express.Router();
const { auth, authorize, allow } = require('../middleware/auth');
const pw = require('../controllers/providerWalletController');

// Provider — own platform balance (read: wallet:view, High tier) + submit a
// top-up (money-movement, stays provider-only).
router.get('/me', auth, allow({ roles: ['provider'], capability: 'wallet:view' }), pw.getMyBalance);
router.post('/topup', auth, authorize('provider'), pw.submitTopUp);

// Admin — oversee and top up provider accounts
router.get('/admin/summary', auth, authorize('admin'), pw.getAdminSummary);
router.get('/admin/wallets', auth, authorize('admin'), pw.getAllWallets);
router.get('/admin/topups', auth, authorize('admin'), pw.getTopUps);
router.get('/admin/provider/:providerId', auth, authorize('admin'), pw.getProviderDetail);
router.post('/admin/topups/:id/approve', auth, authorize('admin'), pw.approveTopUp);
router.post('/admin/topups/:id/reject', auth, authorize('admin'), pw.rejectTopUp);
router.post('/admin/adjust', auth, authorize('admin'), pw.adjustBalance);

module.exports = router;
