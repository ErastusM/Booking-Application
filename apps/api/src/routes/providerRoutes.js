const express = require('express');
const router = express.Router();
const {
    getAllProviders,
    getProviderProfile,
    getProviderProfileBySlug,
    getMySetupStatus,
    getProviderStaff,
    getProviderStaffShiftDays,
    searchProviders,
} = require('../controllers/providerController');
const { auth } = require('../middleware/auth');

router.get('/', getAllProviders);
// Literal paths must precede the catch-all /:id so they aren't swallowed by it.
router.get('/search', searchProviders);
router.get('/by-slug/:slug', getProviderProfileBySlug);
router.get('/me/setup-status', auth, getMySetupStatus);
router.get('/:id/staff', getProviderStaff);
router.get('/:id/staff/:teamMemberId/shift-days', getProviderStaffShiftDays);
router.get('/:id', getProviderProfile);

module.exports = router;