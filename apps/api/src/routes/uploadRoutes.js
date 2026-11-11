const express = require('express');
const rateLimit = require('express-rate-limit');
const { auth } = require('../middleware/auth');
const cloudinary = require('../utils/cloudinary');

const router = express.Router();

// Each signature allows uploads for an hour, so hand them out sparingly.
const photoLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 40,
    keyGenerator: (req) => String(req.user._id), // after auth, so always set
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many uploads. Please wait a few minutes.' },
});

// POST /api/uploads/photo — signed parameters for ONE public picture upload
// (avatar, portfolio or team photo) into the signed-in account's own folder.
// 503 when the server has no Cloudinary credentials: there is no unsigned
// fallback any more.
router.post('/photo', auth, photoLimiter, (req, res) => {
    if (!cloudinary.isConfigured()) {
        return res.status(503).json({ success: false, code: 'photo_upload_unavailable', message: 'Photo uploads are unavailable right now. Please try again later.' });
    }
    return res.status(200).json({ success: true, data: cloudinary.photoUploadParams(req.user._id) });
});

module.exports = router;
