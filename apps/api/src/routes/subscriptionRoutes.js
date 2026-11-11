const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const c = require('../controllers/subscriptionController');

const router = express.Router();

// A business owner's own plan (team members have none of their own).
router.get('/me', auth, authorize('provider'), c.mine);

module.exports = router;
