const express = require('express');
const rateLimit = require('express-rate-limit');
const { ingest, summary } = require('../controllers/eventController');
const { auth, optionalAuth, authorize } = require('../middleware/auth');

const router = express.Router();

// Public ingestion endpoint (browsers may have no token) — rate-limited per IP.
// Batched on the client (~1 request / 12s / tab), so this ceiling is generous
// while still capping abuse. Dropped quietly on flood; the client never retries.
const ingestLimiter = rateLimit({
    windowMs: 60 * 1000,
    // Batched on the client (~1 req / 12s / tab), so 40/min/IP is plenty for real
    // usage while capping a public sink — in line with the client-errors limiter.
    max: process.env.NODE_ENV === 'test' ? 100000 : 40,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (req, res) => res.status(429).end(),
});

router.post('/', ingestLimiter, optionalAuth, ingest);

// Admin-only funnel snapshot.
router.get('/summary', auth, authorize('admin'), summary);

module.exports = router;
