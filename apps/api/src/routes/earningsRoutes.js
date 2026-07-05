const express = require('express');
const router = express.Router();
const { getMyEarnings } = require('../controllers/earningsController');
const { auth, authorize } = require('../middleware/auth');

router.get('/', auth, authorize('provider', 'admin'), getMyEarnings);

module.exports = router;
