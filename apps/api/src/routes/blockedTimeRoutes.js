const express = require('express');
const router = express.Router();
const {
    getMyBlockedTimes,
    createBlockedTime,
    updateBlockedTime,
    deleteBlockedTime,
} = require('../controllers/blockedTimeController');
const { auth, allow } = require('../middleware/auth');

// calendar:manage (Medium tier and up) covers blocked-time CRUD; allow() keeps
// the owner path (can() short-circuits for provider/admin) and adds tiered staff.
// The controllers scope every query to the caller's business, so a staff member
// only reads/writes their own employer's blocks.
router.use(auth, allow({ roles: ['provider'], capability: 'calendar:manage' }));

router.get('/', getMyBlockedTimes);
router.post('/', createBlockedTime);
router.put('/:id', updateBlockedTime);
router.delete('/:id', deleteBlockedTime);

module.exports = router;
