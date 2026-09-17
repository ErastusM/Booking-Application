const express = require('express');
const router = express.Router();
const { auth, authorize, allow } = require('../middleware/auth');
const {
    getMyTeam, addTeamMember, bulkAddTeamMembers, updateTeamMember, deleteTeamMember, restoreTeamMember, setTeamMemberPermissions, getTeamMemberStats,
    getTeamMemberShifts, setTeamMemberShift, clearTeamMemberShift,
    removeTeamMember,
    inviteTeamMember, setTeamMemberServices, setTeamMemberPricing, setTeamMemberPrimary,
    handoverUpcomingBookings,
    getTeamMemberAvailability, updateTeamMemberAvailability,
    getMyServices, setMyServices, addMyService, setMyPricing,
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
// A member adds the service they actually perform. Ticking from the business's
// menu is not enough on a platform that mixes trades — a cleaner hired into a
// barbershop has nothing to tick until someone adds "Cleaning".
router.post('/mine/services', auth, addMyService);
router.put('/mine/pricing', auth, setMyPricing);

// Staff self-view of their OWN stats (token-scoped). Before the per-route gates
// so a staff member — not just the owner — can reach it, and before '/:id/stats'
// so 'mine' isn't read as a member id.
router.get('/mine/stats', auth, getMyStats);

// From here down, every route was previously gated by a single blanket
// `authorize('provider','admin')`. Phase 3c opens the OPERATIONAL roster
// routes to a High staff member via team:manage, so the blanket is replaced by
// EXPLICIT per-route gates — every route below MUST name one, or it would fall
// back to auth-only (reachable by any signed-in user). The two crown-jewel
// routes (permissions, invite) and the still-owner-managed routes (stats,
// shifts, time-off) keep authorize('provider','admin').
const ownerOnly = authorize('provider', 'admin');
// team:manage (High tier) — allow() keeps owner/admin, adds a High staff member;
// the controllers scope every roster query to the caller's business (staffOf).
const canManageTeam = allow({ roles: ['provider', 'admin'], capability: 'team:manage' });

router.get('/', auth, canManageTeam, getMyTeam);
router.post('/', auth, canManageTeam, addTeamMember);
// Add several members at once (per-row results; a bad row doesn't fail the batch).
// Roster management → same team:manage gate as single-add.
router.post('/bulk', auth, canManageTeam, bulkAddTeamMembers);
router.put('/:id', auth, canManageTeam, updateTeamMember);
// DELETE archives rather than removes — bookings, earnings and reviews all
// reference the member, so the row has to outlive their employment.
router.delete('/:id', auth, canManageTeam, deleteTeamMember);
// Permanent, cascading removal (no restore) — purges the member's upcoming
// bookings, schedule, shifts, time off, blocks and login, keeping only paid/
// completed history (snapshotted as "former staff"). See removeTeamMember.
router.delete('/:id/permanent', auth, canManageTeam, removeTeamMember);
router.post('/:id/restore', auth, canManageTeam, restoreTeamMember);
// CROWN JEWEL — OWNER-ONLY. Minting a member's tier/permissions is the one thing
// team:manage must NEVER grant: a High manager could otherwise mint/spread the
// High tier or grant themselves owner-equivalent capabilities. Stays owner/admin.
router.put('/:id/permissions', auth, ownerOnly, setTeamMemberPermissions);
router.get('/:id/stats', auth, ownerOnly, getTeamMemberStats);
// Date-specific working days. A shift replaces the weekly pattern for that
// date; DELETE hands the date back to the pattern. (Owner-managed for now.)
router.get('/:id/shifts', auth, ownerOnly, getTeamMemberShifts);
router.put('/:id/shifts', auth, ownerOnly, setTeamMemberShift);
router.delete('/:id/shifts/:date', auth, ownerOnly, clearTeamMemberShift);
// CROWN JEWEL — OWNER-ONLY. Mints a new privileged account (staffTier/
// staffPermissions with no ceiling) and reads req.user AS the owner (phone,
// businessName, audit receipt), so it is unsuitable for a staff actor. Stays owner/admin.
router.post('/:id/invite', auth, ownerOnly, inviteTeamMember);
// Move a member's upcoming bookings to a colleague (conflicts skipped + reported).
router.post('/:id/handover', auth, canManageTeam, handoverUpcomingBookings);
router.put('/:id/services', auth, canManageTeam, setTeamMemberServices);
router.put('/:id/pricing', auth, canManageTeam, setTeamMemberPricing);
// Choosing the face of the business — a manager task.
router.put('/:id/primary', auth, canManageTeam, setTeamMemberPrimary);

// Time off — a multi-day leave range for a member. Owner-managed here (create is
// approved on the spot); the owner also approves/declines a staff request via
// the decision route. Staff self-service lives on /api/timeoff. (Owner-only for now.)
router.get('/:id/timeoff', auth, ownerOnly, listTimeOff);
router.post('/:id/timeoff', auth, ownerOnly, createTimeOff);
router.patch('/:id/timeoff/:toId/decision', auth, ownerOnly, decideTimeOff);
router.delete('/:id/timeoff/:toId', auth, ownerOnly, deleteTimeOff);

module.exports = router;
