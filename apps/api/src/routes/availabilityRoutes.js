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
// Public: business hours power the "Open/Closed — opens Friday at 09:00" line
// on the public profile (incl. /b/<slug> links viewed while logged out).
router.get('/:providerId', getProviderAvailability);

module.exports = router;