const express = require('express');
const router = express.Router();
const { auth, allow } = require('../middleware/auth');
const { getMyClients, getClientDetail, upsertClientNote } = require('../controllers/clientCRMController');

router.use(auth);

// Reads need clients:assigned — held by EVERY staff member (it is in the Basic
// baseline), because a staff member is entitled to the clients they personally
// serve from day one (Epic 2.4 AC). The note write still needs clients:edit
// (Medium+). allow() keeps owner/admin access (can() short-circuits for them).
//
// The gate only decides who may open the CRM; buildClientScope in the controller
// decides WHAT they see — owner/admin the whole business, staff strictly their
// assigned clients. Nothing widens a staff principal to the full list.
router.get('/clients', allow({ roles: ['admin', 'provider'], capability: 'clients:assigned' }), getMyClients);
router.get('/clients/:customerId', allow({ roles: ['admin', 'provider'], capability: 'clients:assigned' }), getClientDetail);
router.put('/clients/:customerId/notes', allow({ roles: ['admin', 'provider'], capability: 'clients:edit' }), upsertClientNote);

module.exports = router;
