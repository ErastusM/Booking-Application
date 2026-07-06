const express = require('express');
const router = express.Router();
const {
    getMyAvailability,
    updateMyAvailability,
    getProviderAvailability,
} = require('../controllers/availabilityController');
const { auth, authorize } = require('../middleware/auth');

router.get('/me', auth, authorize('provider'), getMyAvailability);
router.put('/me', auth, authorize('provider'), updateMyAvailability);
router.get('/:providerId', auth, getProviderAvailability);

module.exports = router;