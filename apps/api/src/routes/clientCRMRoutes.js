const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middleware/auth');
const { getMyClients, getClientDetail, upsertClientNote } = require('../controllers/clientCRMController');

router.use(auth);

// Reads need clients:view, the note write needs clients:edit (both Medium tier
// and up). allow() keeps owner/admin access (can() short-circuits for them) and
// adds the tiered-staff path; the controllers scope every query to the caller's
// business, so a staff member only ever reaches their own employer's clients.
router.get('/clients', allow({ roles: ['admin', 'provider'], capability: 'clients:view' }), getMyClients);
router.get('/clients/:customerId', allow({ roles: ['admin', 'provider'], capability: 'clients:view' }), getClientDetail);
router.put('/clients/:customerId/notes', allow({ roles: ['admin', 'provider'], capability: 'clients:edit' }), upsertClientNote);

module.exports = router;
