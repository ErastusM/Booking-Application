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
// READING is open to every staff member (calendar:view): a team member's own
// calendar must show the time that is blocked for them. The controller narrows a
// member without calendar:view_all to their own blocks plus business-wide ones.
const canManage = allow({ roles: ['provider'], capability: 'calendar:manage' });
router.get('/', auth, allow({ roles: ['provider'], capability: 'calendar:view' }), getMyBlockedTimes);
router.post('/', auth, canManage, createBlockedTime);
router.put('/:id', auth, canManage, updateBlockedTime);
router.delete('/:id', auth, canManage, deleteBlockedTime);

module.exports = router;
