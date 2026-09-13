const express = require('express');
const router = express.Router();
const {
    getProviderLocations,
    getMyLocations,
    createLocation,
    updateLocation,
    setPrimaryLocation,
} = require('../controllers/locationController');
const { auth, authorize } = require('../middleware/auth');

// Public: a provider's active locations, for the booking page's location picker.
router.get('/provider/:providerId', getProviderLocations);

// Owner-only: managing locations is a business-owner task, and every handler
// below is provider-scoped to req.user._id.
router.get('/mine', auth, authorize('provider'), getMyLocations);
router.post('/', auth, authorize('provider'), createLocation);
router.put('/:id', auth, authorize('provider'), updateLocation);
router.put('/:id/primary', auth, authorize('provider'), setPrimaryLocation);

module.exports = router;
