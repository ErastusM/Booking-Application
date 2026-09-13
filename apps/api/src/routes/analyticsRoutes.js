const express = require('express');
const router = express.Router();
const { getAnalytics, getProviderAnalytics, getProviderRevenueList, getProviderRevenueDetail } = require('../controllers/analyticsController');
const { auth, authorize, allow } = require('../middleware/auth');

// Platform-wide roll-up stays admin-only (no per-business scope).
router.get('/', auth, authorize('admin'), getAnalytics);
// Per-business operational analytics — reports:view (High tier). The controller
// scopes to the caller's business (staffOf for a High staff member).
router.get('/provider', auth, allow({ roles: ['provider', 'admin'], capability: 'reports:view' }), getProviderAnalytics);
// Admin per-provider revenue: leaderboard + single-provider detail.
router.get('/admin/providers', auth, authorize('admin'), getProviderRevenueList);
router.get('/admin/providers/:id', auth, authorize('admin'), getProviderRevenueDetail);

module.exports = router;