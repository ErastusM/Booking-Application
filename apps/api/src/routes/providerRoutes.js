const express = require('express');
const router = express.Router();
const { getAllProviders, getProviderProfile, getProviderStaff, searchProviders } = require('../controllers/providerController');

router.get('/', getAllProviders);
router.get('/search', searchProviders); // must precede /:id
router.get('/:id/staff', getProviderStaff);
router.get('/:id', getProviderProfile);

module.exports = router;