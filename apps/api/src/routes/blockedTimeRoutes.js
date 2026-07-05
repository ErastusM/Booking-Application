const express = require('express');
const router = express.Router();
const {
    getMyBlockedTimes,
    createBlockedTime,
    updateBlockedTime,
    deleteBlockedTime,
} = require('../controllers/blockedTimeController');
const { auth, authorize } = require('../middleware/auth');

router.use(auth, authorize('provider'));

router.get('/', getMyBlockedTimes);
router.post('/', createBlockedTime);
router.put('/:id', updateBlockedTime);
router.delete('/:id', deleteBlockedTime);

module.exports = router;
