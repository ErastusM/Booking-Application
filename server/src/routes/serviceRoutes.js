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
const { auth, authorize } = require('../middleware/auth');
const { createServiceRules, updateServiceRules } = require('../middleware/validate');

router.get('/', getAllServices);
router.get('/my-services', auth, authorize('provider'), getMyServices);
router.post('/', auth, authorize('admin'), createServiceRules, createService);
router.post('/my-services', auth, authorize('provider'), createServiceRules, createMyService);
router.put('/:id', auth, authorize('admin', 'provider'), updateServiceRules, updateService);
router.delete('/:id', auth, authorize('admin', 'provider'), deleteService);

module.exports = router;