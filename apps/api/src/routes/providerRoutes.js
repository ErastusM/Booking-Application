const express = require('express');
const router = express.Router();
const { getAllProviders, getProviderProfile } = require('../controllers/providerController');

router.get('/', getAllProviders);
router.get('/:id', getProviderProfile);

module.exports = router;