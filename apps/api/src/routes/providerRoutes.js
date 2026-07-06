const express = require('express');
const router = express.Router();
const { getAllProviders, getProviderProfile, getProviderStaff } = require('../controllers/providerController');

router.get('/', getAllProviders);
router.get('/:id/staff', getProviderStaff);
router.get('/:id', getProviderProfile);

module.exports = router;