const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middleware/auth');
const { getRetentionMetrics } = require('../controllers/retentionController');

router.use(auth);
// reports:view (High tier) — allow() keeps owner/admin and adds a High staff
// member; the controller scopes to the caller's business (staffOf for staff).
router.use(allow({ roles: ['admin', 'provider'], capability: 'reports:view' }));

router.get('/', getRetentionMetrics);

module.exports = router;
