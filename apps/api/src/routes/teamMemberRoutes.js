const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const {
    getMyTeam, addTeamMember, updateTeamMember, deleteTeamMember, restoreTeamMember, setTeamMemberPermissions, getTeamMemberStats,
    inviteTeamMember, setTeamMemberServices,
    getTeamMemberAvailability, updateTeamMemberAvailability,
} = require('../controllers/teamMemberController');

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
router.post('/:id/invite', inviteTeamMember);
router.put('/:id/services', setTeamMemberServices);

module.exports = router;
