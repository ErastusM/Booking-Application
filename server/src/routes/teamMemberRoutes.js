const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const { getMyTeam, addTeamMember, updateTeamMember, deleteTeamMember } = require('../controllers/teamMemberController');

router.use(auth, authorize('provider', 'admin'));

router.get('/', getMyTeam);
router.post('/', addTeamMember);
router.put('/:id', updateTeamMember);
router.delete('/:id', deleteTeamMember);

module.exports = router;
