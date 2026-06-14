const express = require('express');
const router = express.Router();
const { getAnalytics, getProviderAnalytics } = require('../controllers/analyticsController');
const { auth, authorize } = require('../middleware/auth');

router.get('/', auth, authorize('admin'), getAnalytics);
router.get('/provider', auth, authorize('provider', 'admin'), getProviderAnalytics);

module.exports = router;