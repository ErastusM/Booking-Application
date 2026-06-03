const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const { getRetentionMetrics } = require('../controllers/retentionController');

router.use(auth);
router.use(authorize('admin', 'provider'));

router.get('/', getRetentionMetrics);

module.exports = router;
