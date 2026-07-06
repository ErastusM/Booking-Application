const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { getMyConversations, getMessages, sendMessage, getUnreadCount } = require('../controllers/messageController');

router.use(auth);
router.get('/conversations', getMyConversations);
router.get('/unread-count', getUnreadCount);
router.get('/:appointmentId', getMessages);
router.post('/:appointmentId', sendMessage);

module.exports = router;
