const express = require('express');

const router = express.Router();
const { auth } = require('../middleware/auth');
const { getMyTimeclock, clockIn, clockOut, getMemberTimeclock } = require('../controllers/timeClockController');

// `auth` only — the controllers resolve the signed-in staff member's own record
// (token-scoped) for the /mine routes, and scope the owner view to the caller as
// provider. Registered BEFORE '/:memberId' so 'mine' can't be read as an id.
router.use(auth);

router.get('/mine', getMyTimeclock);
router.post('/mine/in', clockIn);
router.post('/mine/out', clockOut);

// Owner view of one member's timesheet (scoped to the caller's business).
router.get('/:memberId', getMemberTimeclock);

module.exports = router;
