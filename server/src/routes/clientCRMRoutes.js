const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { getMyClients, getClientDetail, upsertClientNote } = require('../controllers/clientCRMController');

router.use(protect);
router.use(authorize('admin', 'provider'));

router.get('/clients', getMyClients);
router.get('/clients/:customerId', getClientDetail);
router.put('/clients/:customerId/notes', upsertClientNote);

module.exports = router;
