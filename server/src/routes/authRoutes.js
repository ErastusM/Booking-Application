const express = require('express');
const router = express.Router();
const {
    register,
    login,
    logout,
    getProfile,
    updateProfile
} = require('../controllers/authController');
const { auth } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/logout', auth, logout);
router.get('/profile', auth, getProfile);
router.put('/profile', auth, updateProfile);

module.exports = router;
