const express = require('express');
const router = express.Router();
const { getPublicKey, subscribe, unsubscribe } = require('../controllers/pushController');
const { auth } = require('../middleware/auth');

router.get('/vapid-public-key', getPublicKey);
router.post('/subscribe', auth, subscribe);
router.post('/unsubscribe', auth, unsubscribe);

module.exports = router;
