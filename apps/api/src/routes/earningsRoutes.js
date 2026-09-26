const express = require('express');
const router = express.Router();
const { getMyEarnings, getMyOwnEarnings } = require('../controllers/earningsController');
const { auth, allow } = require('../middleware/auth');

// A team member's OWN earnings (any level): money from the completed bookings
// they performed. Registered before '/' so it never falls into the business report.
router.get('/mine', auth, getMyOwnEarnings);

// reports:view (High tier) — a High staff member sees their employer's earnings
// report; the controller scopes every aggregate to the business (staffOf).
router.get('/', auth, allow({ roles: ['provider', 'admin'], capability: 'reports:view' }), getMyEarnings);

module.exports = router;
