const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { getRetentionMetrics } = require('../controllers/retentionController');

router.use(protect);
router.use(authorize('admin', 'provider'));

router.get('/', getRetentionMetrics);

module.exports = router;
