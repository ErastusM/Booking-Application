const express = require('express');
const router = express.Router();
const {
    getAllServices,
    getMyServices,
    createService,
    createMyService,
    updateService,
    deleteService,
} = require('../controllers/serviceController');
const { auth, authorize, allow } = require('../middleware/auth');
const { createServiceRules, updateServiceRules } = require('../middleware/validate');

// services:edit (High tier) covers catalogue management; allow() keeps owner/admin
// and adds a High staff member; the controllers scope to the caller's business.
const canEditServices = allow({ roles: ['admin', 'provider'], capability: 'services:edit' });

router.get('/', getAllServices); // public marketplace read — never gated
router.get('/my-services', auth, allow({ roles: ['provider'], capability: 'services:edit' }), getMyServices);
router.post('/', auth, authorize('admin'), createServiceRules, createService); // admin GLOBAL service (provider:null) — stays admin-only
router.post('/my-services', auth, allow({ roles: ['provider'], capability: 'services:edit' }), createServiceRules, createMyService);
router.put('/:id', auth, canEditServices, updateServiceRules, updateService);
router.delete('/:id', auth, canEditServices, deleteService);

module.exports = router;