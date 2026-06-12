const express = require('express');
const router = express.Router();
const {
    joinWaitingList,
    getMyWaitingList,
    getProviderWaitingList,
    leaveWaitingList,
    getNotifications,
} = require('../controllers/waitingListController');
const { auth, authorize } = require('../middleware/auth');
const { joinWaitingListRules } = require('../middleware/validate');

router.post('/', auth, authorize('customer'), joinWaitingListRules, joinWaitingList);
router.get('/', auth, getMyWaitingList);
router.get('/provider', auth, authorize('provider', 'admin'), getProviderWaitingList);
router.get('/notifications', auth, getNotifications);
router.delete('/:id', auth, leaveWaitingList);

module.exports = router;
