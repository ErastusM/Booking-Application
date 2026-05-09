const express = require('express');
const router = express.Router();
const {
    getMyNotifications,
    markAllRead,
    markOneRead,
    deleteNotification,
} = require('../controllers/notificationController');
const { auth } = require('../middleware/auth');

router.get('/', auth, getMyNotifications);
router.put('/mark-all-read', auth, markAllRead);
router.put('/:id/read', auth, markOneRead);
router.delete('/:id', auth, deleteNotification);

module.exports = router;