const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const {
    getMyTeam, addTeamMember, updateTeamMember, deleteTeamMember, restoreTeamMember,
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
router.post('/:id/invite', inviteTeamMember);
router.put('/:id/services', setTeamMemberServices);

module.exports = router;
