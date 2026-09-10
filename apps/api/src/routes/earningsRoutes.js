const express = require('express');
const router = express.Router();
const { getMyEarnings } = require('../controllers/earningsController');
const { auth, allow } = require('../middleware/auth');

// reports:view (High tier) — a High staff member sees their employer's earnings
// report; the controller scopes every aggregate to the business (staffOf).
router.get('/', auth, allow({ roles: ['provider', 'admin'], capability: 'reports:view' }), getMyEarnings);

module.exports = router;
