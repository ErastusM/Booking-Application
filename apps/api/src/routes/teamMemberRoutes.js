const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const {
    getMyTeam, addTeamMember, updateTeamMember, deleteTeamMember, restoreTeamMember, setTeamMemberPermissions, getTeamMemberStats,
    getTeamMemberShifts, setTeamMemberShift, clearTeamMemberShift,
    inviteTeamMember, setTeamMemberServices,
    getTeamMemberAvailability, updateTeamMemberAvailability,
} = require('../controllers/teamMemberController');
const {
    listTimeOff, createTimeOff, decideTimeOff, deleteTimeOff,
} = require('../controllers/timeOffController');

// Availability is auth-only: the controller allows provider/admin OR the staff
// member themself (a role the blanket authorize below would reject).
router.get('/:id/availability', auth, getTeamMemberAvailability);
router.put('/:id/availability', auth, updateTeamMemberAvailability);

router.use(auth, authorize('provider', 'admin'));

router.get('/', getMyTeam);
router.post('/', addTeamMember);
router.put('/:id', updateTeamMember);
// DELETE archives rather than removes — bookings, earnings and reviews all
// reference the member, so the row has to outlive their employment.
router.delete('/:id', deleteTeamMember);
router.post('/:id/restore', restoreTeamMember);
// Owner-only by virtue of the blanket authorize above — a staff member setting
// their own permissions is the one thing this must never allow.
router.put('/:id/permissions', setTeamMemberPermissions);
router.get('/:id/stats', getTeamMemberStats);
// Date-specific working days. A shift replaces the weekly pattern for that
// date; DELETE hands the date back to the pattern.
router.get('/:id/shifts', getTeamMemberShifts);
router.put('/:id/shifts', setTeamMemberShift);
router.delete('/:id/shifts/:date', clearTeamMemberShift);
router.post('/:id/invite', inviteTeamMember);
router.put('/:id/services', setTeamMemberServices);

// Time off — a multi-day leave range for a member. Owner-managed here (create is
// approved on the spot); the owner also approves/declines a staff request via
// the decision route. Staff self-service lives on /api/timeoff.
router.get('/:id/timeoff', listTimeOff);
router.post('/:id/timeoff', createTimeOff);
router.patch('/:id/timeoff/:toId/decision', decideTimeOff);
router.delete('/:id/timeoff/:toId', deleteTimeOff);

module.exports = router;
