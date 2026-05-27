const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getMyConversations, getMessages, sendMessage, getUnreadCount } = require('../controllers/messageController');

router.use(protect);
router.get('/conversations', getMyConversations);
router.get('/unread-count', getUnreadCount);
router.get('/:appointmentId', getMessages);
router.post('/:appointmentId', sendMessage);

module.exports = router;
