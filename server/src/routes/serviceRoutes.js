const express = require('express');
const router = express.Router();
const {
    getAllServices,
    getServiceById,
    createService,
    updateService,
    deleteService
} = require('../controllers/serviceController');
const { auth, authorize } = require('../middleware/auth');

router.get('/', getAllServices);
router.get('/:id', getServiceById);
router.post('/', auth, authorize('admin'), createService);
router.put('/:id', auth, authorize('admin'), updateService);
router.delete('/:id', auth, authorize('admin'), deleteService);

module.exports = router;
