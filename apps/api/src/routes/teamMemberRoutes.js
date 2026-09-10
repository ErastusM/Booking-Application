const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const {
    getMyTeam, addTeamMember, updateTeamMember, deleteTeamMember, restoreTeamMember, setTeamMemberPermissions, getTeamMemberStats,
    getTeamMemberShifts, setTeamMemberShift, clearTeamMemberShift,
    removeTeamMember,
    inviteTeamMember, setTeamMemberServices, setTeamMemberPricing, setTeamMemberPrimary,
    handoverUpcomingBookings,
    getTeamMemberAvailability, updateTeamMemberAvailability,
    getMyServices, setMyServices, setMyPricing,
    getMyProfile, setMyProfile, getMyAvailability, setMyAvailability,
    getMyStats,
} = require('../controllers/teamMemberController');
const {
    listTimeOff, createTimeOff, decideTimeOff, deleteTimeOff,
} = require('../controllers/timeOffController');

// Staff self-service (token-scoped, no id in the URL). MUST be registered
// BEFORE the /:id/* routes below, or '/:id/availability' would match
// '/mine/availability' with id='mine' and swallow it.
router.get('/mine/profile', auth, getMyProfile);
router.put('/mine/profile', auth, setMyProfile);
router.get('/mine/availability', auth, getMyAvailability);
router.put('/mine/availability', auth, setMyAvailability);

// Availability is auth-only: the controller allows provider/admin OR the staff
// member themself (a role the blanket authorize below would reject).
router.get('/:id/availability', auth, getTeamMemberAvailability);
router.put('/:id/availability', auth, updateTeamMemberAvailability);

// Staff self-service: a member manages their OWN service list. Registered before
// the provider/admin blanket (and before /:id/services) so 'mine' resolves here
// from the token rather than being read as a member id.
router.get('/mine/services', auth, getMyServices);
router.put('/mine/services', auth, setMyServices);
router.put('/mine/pricing', auth, setMyPricing);

// Staff self-view of their OWN stats (token-scoped). Before the blanket so a
// staff member — not just the owner — can reach it, and before '/:id/stats' so
// 'mine' isn't read as a member id.
router.get('/mine/stats', auth, getMyStats);

router.use(auth, authorize('provider', 'admin'));

router.get('/', getMyTeam);
router.post('/', addTeamMember);
router.put('/:id', updateTeamMember);
// DELETE archives rather than removes — bookings, earnings and reviews all
// reference the member, so the row has to outlive their employment.
router.delete('/:id', deleteTeamMember);
// Permanent, cascading removal (no restore) — purges the member's upcoming
// bookings, schedule, shifts, time off, blocks and login, keeping only paid/
// completed history (snapshotted as "former staff"). See removeTeamMember.
router.delete('/:id/permanent', removeTeamMember);
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
// Move a member's upcoming bookings to a colleague (conflicts skipped + reported).
router.post('/:id/handover', handoverUpcomingBookings);
router.put('/:id/services', setTeamMemberServices);
router.put('/:id/pricing', setTeamMemberPricing);
// Owner-only (blanket authorize above): choosing the face of the business.
router.put('/:id/primary', setTeamMemberPrimary);

// Time off — a multi-day leave range for a member. Owner-managed here (create is
// approved on the spot); the owner also approves/declines a staff request via
// the decision route. Staff self-service lives on /api/timeoff.
router.get('/:id/timeoff', listTimeOff);
router.post('/:id/timeoff', createTimeOff);
router.patch('/:id/timeoff/:toId/decision', decideTimeOff);
router.delete('/:id/timeoff/:toId', deleteTimeOff);

module.exports = router;
