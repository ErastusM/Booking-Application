const express = require('express');
const router = express.Router();
const {
    getMyBlockedTimes,
    createBlockedTime,
    updateBlockedTime,
    deleteBlockedTime,
} = require('../controllers/blockedTimeController');
const { auth, allow } = require('../middleware/auth');

// WRITING: calendar:manage (Medium tier and up) covers every block in the
// business; calendar:block:self (Service provider and up) lets a member create,
// edit and delete blocks in their OWN lane only — the controller forces and
// checks the lane (never business-wide, owner-only or a colleague's). allow()
// keeps the owner path (can() short-circuits for provider/admin).
// The controllers scope every query to the caller's business, so a staff member
// only reads/writes their own employer's blocks.
// READING is open to every staff member (calendar:view): a team member's own
// calendar must show the time that is blocked for them. The controller narrows a
// member without calendar:view_all to their own blocks plus business-wide ones.
const canBlock = allow({ roles: ['provider'], capability: ['calendar:manage', 'calendar:block:self'] });
router.get('/', auth, allow({ roles: ['provider'], capability: 'calendar:view' }), getMyBlockedTimes);
router.post('/', auth, canBlock, createBlockedTime);
router.put('/:id', auth, canBlock, updateBlockedTime);
router.delete('/:id', auth, canBlock, deleteBlockedTime);

module.exports = router;
