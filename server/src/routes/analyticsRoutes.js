const express = require('express');
const router = express.Router();
const { getAnalytics } = require('../controllers/analyticsController');
const { auth, authorize } = require('../middleware/auth');

router.get('/', auth, authorize('admin'), getAnalytics);

module.exports = router;