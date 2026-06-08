const express = require('express');
const router = express.Router();
const { getAllUsers, deleteUser, updateUserRole, toggleUserActive } = require('../controllers/userController');
const { auth, authorize } = require('../middleware/auth');

router.get('/', auth, authorize('admin'), getAllUsers);
router.delete('/:id', auth, authorize('admin'), deleteUser);
router.put('/:id/role', auth, authorize('admin'), updateUserRole);
router.put('/:id/active', auth, authorize('admin'), toggleUserActive);

module.exports = router;