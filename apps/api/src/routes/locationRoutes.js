const express = require('express');
const router = express.Router();
const {
    getMyLocations,
    createLocation,
    updateLocation,
    setPrimaryLocation,
} = require('../controllers/locationController');
const { auth, authorize } = require('../middleware/auth');

// Owner-only for now: managing locations is a business-owner task, and every
// handler is provider-scoped to req.user._id. (A later PR may expose a public
// read of a provider's active locations for the booking page.)
router.get('/mine', auth, authorize('provider'), getMyLocations);
router.post('/', auth, authorize('provider'), createLocation);
router.put('/:id', auth, authorize('provider'), updateLocation);
router.put('/:id/primary', auth, authorize('provider'), setPrimaryLocation);

module.exports = router;
