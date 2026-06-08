const express = require('express');
const router = express.Router();
const { submitSuggestion } = require('../controllers/suggestionController');
const { auth } = require('../middleware/auth');

// Optional auth — logged-in users get name/email pre-filled, guests can still submit
router.post('/', (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) return auth(req, res, next);
    next();
}, submitSuggestion);

module.exports = router;
