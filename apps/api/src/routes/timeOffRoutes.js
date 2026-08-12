const express = require('express');

const router = express.Router();
const { auth } = require('../middleware/auth');
const { listMyTimeOff, requestTimeOff, cancelMyTimeOff } = require('../controllers/timeOffController');

// Staff self-service. `auth` only — the controller resolves the signed-in staff
// member's own record and scopes everything to it, so a provider (who has no
// team-member record) simply gets nothing here. Owner-facing management lives on
// /api/team/:id/timeoff.
router.use(auth);

router.get('/mine', listMyTimeOff);
router.post('/mine', requestTimeOff);
router.delete('/mine/:toId', cancelMyTimeOff);

module.exports = router;
