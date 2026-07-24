const express = require('express');
const router = express.Router();
const { getAnalytics, getProviderAnalytics, getProviderRevenueList, getProviderRevenueDetail } = require('../controllers/analyticsController');
const { auth, authorize } = require('../middleware/auth');

router.get('/', auth, authorize('admin'), getAnalytics);
router.get('/provider', auth, authorize('provider', 'admin'), getProviderAnalytics);
// Admin per-provider revenue: leaderboard + single-provider detail.
router.get('/admin/providers', auth, authorize('admin'), getProviderRevenueList);
router.get('/admin/providers/:id', auth, authorize('admin'), getProviderRevenueDetail);

module.exports = router;