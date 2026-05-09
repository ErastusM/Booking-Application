const express = require('express');
const router = express.Router();
const {
    joinWaitingList,
    getMyWaitingList,
    leaveWaitingList,
    getNotifications,
} = require('../controllers/waitingListController');
const { auth, authorize } = require('../middleware/auth');

router.post('/', auth, authorize('customer'), joinWaitingList);
router.get('/', auth, getMyWaitingList);
router.delete('/:id', auth, leaveWaitingList);
router.get('/notifications', auth, getNotifications);

module.exports = router;