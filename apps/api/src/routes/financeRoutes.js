/**
 * /api/admin/finance — Bookplus's money controls (controllers/financeController.js).
 * Admin accounts only, in a session confirmed with two-step sign-in, holding
 * the finance or director role (utils/financeRoles.requireFinance). Not tied
 * to SUBSCRIPTION_BILLING_ENABLED: the plan's prices and the launch
 * checklist are set up before plan billing is switched on.
 */
const express = require('express');
const { auth } = require('../middleware/auth');
const { requireFinance } = require('../utils/financeRoles');
const c = require('../controllers/financeController');
const subs = require('../controllers/subscriptionController');

const router = express.Router();
const finance = [auth, requireFinance('finance')];
const director = [auth, requireFinance('director')];

// The plan's prices and VAT; the launch checklist.
router.get('/settings', finance, c.getSettings);
router.put('/settings', director, c.updateSettings);
router.post('/launch/:gate', director, c.setLaunchGate);
// Do the server's PayGate settings work? (no money moves)
router.post('/paygate-check', finance, c.paygateCheck);

// Business subscriptions: who is kept free, on a trial or paying.
router.get('/subscriptions', finance, subs.list);
router.put('/subscriptions/visibility', director, subs.setVisibility);
router.post('/subscriptions/:id/trial', director, subs.move('trial'));
router.post('/subscriptions/:id/keep-free', director, subs.move('keep-free'));

// Who did what.
router.get('/audit', finance, c.getAudit);

// Admins' money roles and two-step sign-in.
router.get('/admins', finance, c.listAdmins);
router.put('/admins/:id/roles', director, c.setAdminRoles);
router.post('/admins/:id/reset-mfa', director, c.resetAdminMfa);

module.exports = router;
