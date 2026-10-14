/**
 * /api/admin/finance — Bookplus's money controls (controllers/financeController.js).
 * Admin accounts only, in a session confirmed with two-step sign-in, holding
 * the finance or director role (utils/financeRoles.requireFinance). Not tied
 * to PAYMENTS_ENABLED: the prices, fees and launch checklist are set up
 * before payments are switched on.
 */
const express = require('express');
const { auth } = require('../middleware/auth');
const { requireFinance } = require('../utils/financeRoles');
const c = require('../controllers/financeController');

const router = express.Router();
const finance = [auth, requireFinance('finance')];
const director = [auth, requireFinance('director')];

// Prices, fees, payouts, VAT, approvals; the simulator; the launch checklist.
router.get('/settings', finance, c.getSettings);
router.put('/settings', director, c.updateSettings);
router.get('/simulate', finance, c.simulate);
router.post('/launch/:gate', director, c.setLaunchGate);

// A business's plan and agreed rates.
router.put('/businesses/:id/pricing', director, c.setBusinessPricing);

// Refunds and adjustments: finance prepares, a different director approves.
router.post('/payments/:id/refund', finance, c.prepareRefund);
router.post('/adjustments', finance, c.prepareAdjustment);
router.get('/requests', finance, c.listRequests);
router.post('/requests/:id/approve', director, c.approveRequest);
router.post('/requests/:id/reject', director, c.rejectRequest);

// Who did what.
router.get('/audit', finance, c.getAudit);

// Admins' money roles and two-step sign-in.
router.get('/admins', finance, c.listAdmins);
router.put('/admins/:id/roles', director, c.setAdminRoles);
router.post('/admins/:id/reset-mfa', director, c.resetAdminMfa);

module.exports = router;
