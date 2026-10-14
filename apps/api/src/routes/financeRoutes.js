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

// Businesses applying to take online payments (finance reviews them).
router.get('/approvals', finance, c.listApprovals);
router.get('/approvals/:id', finance, c.getApproval);
router.get('/approvals/:id/documents/:docId', finance, c.getApprovalDocument);
router.post('/approvals/:id/decision', finance, c.decideApproval);
router.post('/approvals/:id/switch', finance, c.setApprovalSwitch);
router.post('/approvals/:id/payout-account-checked', finance, c.confirmPayoutAccount);

// Day-to-day money work (controllers/moneyOpsController.js).
const ops = require('../controllers/moneyOpsController');
router.get('/payments', finance, ops.listPayments);
router.post('/payments/:id/sync', finance, ops.syncPayment);
router.post('/payments/:id/refunds/:refundId/retry', finance, ops.retryRefund);
router.get('/payouts/due', finance, ops.payoutsDue);
router.post('/payouts/run', finance, ops.preparePayouts);
router.get('/payouts/bank-file.csv', finance, ops.bankFileCsv);
router.get('/payouts', finance, ops.listPayouts);
router.post('/payouts/:id/paid', finance, ops.payoutPaid);
router.post('/payouts/:id/failed', finance, ops.payoutFailed);
router.get('/disputes', finance, ops.listDisputes);
router.post('/disputes', finance, ops.openDispute);
router.get('/disputes/:id', finance, ops.getDispute);
router.post('/disputes/:id/notes', finance, ops.addDisputeNote);
router.post('/disputes/:id/evidence/upload', finance, ops.evidenceUploadParams);
router.post('/disputes/:id/evidence', finance, ops.addEvidence);
router.get('/disputes/:id/evidence/:evidenceId', finance, ops.getEvidence);
router.post('/disputes/:id/refund', finance, ops.refundFromDispute);
router.post('/disputes/:id/close', finance, ops.closeDispute);

// Who did what.
router.get('/audit', finance, c.getAudit);

// Admins' money roles and two-step sign-in.
router.get('/admins', finance, c.listAdmins);
router.put('/admins/:id/roles', director, c.setAdminRoles);
router.post('/admins/:id/reset-mfa', director, c.resetAdminMfa);

module.exports = router;
